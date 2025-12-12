import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import net from 'net';
import tls from 'tls';
import { URL } from 'url';
import { Duplex } from 'stream';
import fs from 'fs';
import { generateCACert, generateHostCert, getCACertPath } from './certificate.js';

export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
    duration: number;
  };
}

class ProxyServer extends EventEmitter {
  private server: http.Server | null = null;
  private requestId = 0;
  private caCert: { key: string; cert: string } | null = null;

  constructor() {
    super();
    // Prevent unhandled error crashes
    this.on('error', (err) => {
      // Silently handle connection errors (ECONNRESET, etc.)
      // These are normal when connections are interrupted
    });
  }

  async start(port: number): Promise<void> {
    // Skip CA certificate - we'll use tunnel mode for HTTPS
    // This avoids certificate installation hassle for users
    // HTTP: full visibility, HTTPS: domain/timing only
    this.caCert = null;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Handle CONNECT for HTTPS
      this.server.on('connect', (req, clientSocket, head) => {
        this.handleConnect(req, clientSocket, head);
      });

      this.server.on('error', reject);

      this.server.listen(port, () => {
        resolve();
      });
    });
  }

  private handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const id = `req_${++this.requestId}`;
    const startTime = Date.now();
    const url = clientReq.url || '';

    let body = '';
    clientReq.on('data', (chunk) => {
      body += chunk.toString();
    });

    clientReq.on('end', () => {
      const request: NetworkRequest = {
        id,
        method: clientReq.method || 'GET',
        url,
        headers: clientReq.headers as Record<string, string>,
        body: body || undefined,
        timestamp: startTime,
      };

      this.emit('request', request);

      // Parse target URL
      let targetUrl: URL;
      try {
        targetUrl = new URL(url);
      } catch {
        clientRes.writeHead(400);
        clientRes.end('Invalid URL');
        return;
      }

      const options: http.RequestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: targetUrl.pathname + targetUrl.search,
        method: clientReq.method,
        headers: clientReq.headers,
      };

      const proxyReq = http.request(options, (proxyRes) => {
        let responseBody = '';

        proxyRes.on('data', (chunk) => {
          responseBody += chunk.toString();
        });

        proxyRes.on('end', () => {
          request.response = {
            status: proxyRes.statusCode || 0,
            statusText: proxyRes.statusMessage || '',
            headers: proxyRes.headers as Record<string, string>,
            body: responseBody,
            duration: Date.now() - startTime,
          };

          this.emit('response', request);
        });

        clientRes.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(clientRes);
      });

      proxyReq.on('error', (err) => {
        this.emit('error', { id, error: err.message });
        clientRes.writeHead(502);
        clientRes.end('Proxy Error');
      });

      if (body) {
        proxyReq.write(body);
      }
      proxyReq.end();
    });
  }

  private handleConnect(req: http.IncomingMessage, clientSocket: Duplex, head: Buffer): void {
    const id = `req_${++this.requestId}`;
    const [hostname, port] = (req.url || '').split(':');
    const targetPort = parseInt(port) || 443;

    const request: NetworkRequest = {
      id,
      method: 'CONNECT',
      url: `https://${req.url}`,
      headers: req.headers as Record<string, string>,
      timestamp: Date.now(),
    };

    this.emit('request', request);

    // If we have CA cert, do MITM
    if (this.caCert) {
      this.handleHttpsWithMitm(hostname, targetPort, clientSocket, head, request);
    } else {
      // Simple tunnel without MITM
      this.handleHttpsTunnel(hostname, targetPort, clientSocket, head, request);
    }
  }

  private handleHttpsTunnel(
    hostname: string,
    targetPort: number,
    clientSocket: Duplex,
    head: Buffer,
    request: NetworkRequest
  ): void {
    const serverSocket = net.connect(targetPort, hostname, () => {
      clientSocket.write(
        'HTTP/1.1 200 Connection Established\r\n' +
        'Proxy-agent: DevLens\r\n' +
        '\r\n'
      );

      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);

      request.response = {
        status: 200,
        statusText: 'Connection Established (Tunnel)',
        headers: {},
        duration: Date.now() - request.timestamp,
      };

      this.emit('response', request);
    });

    serverSocket.on('error', (err) => {
      this.emit('error', { id: request.id, error: err.message });
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      serverSocket.end();
    });
  }

  private handleHttpsWithMitm(
    hostname: string,
    targetPort: number,
    clientSocket: Duplex,
    head: Buffer,
    request: NetworkRequest
  ): void {
    try {
      const hostCert = generateHostCert(hostname);

      // Tell client connection is established
      clientSocket.write(
        'HTTP/1.1 200 Connection Established\r\n' +
        'Proxy-agent: DevLens\r\n' +
        '\r\n'
      );

      // Create TLS server for client
      const tlsOptions = {
        key: fs.readFileSync(hostCert.key),
        cert: fs.readFileSync(hostCert.cert),
      };

      const tlsSocket = new tls.TLSSocket(clientSocket as net.Socket, tlsOptions);

      tlsSocket.on('data', (data) => {
        this.handleHttpsRequest(hostname, targetPort, data, tlsSocket, request);
      });

      tlsSocket.on('error', () => {
        clientSocket.end();
      });

      request.response = {
        status: 200,
        statusText: 'Connection Established (MITM)',
        headers: {},
        duration: Date.now() - request.timestamp,
      };

      this.emit('response', request);
    } catch (error) {
      // Fallback to tunnel
      this.handleHttpsTunnel(hostname, targetPort, clientSocket, head, request);
    }
  }

  private handleHttpsRequest(
    hostname: string,
    port: number,
    data: Buffer,
    clientSocket: tls.TLSSocket,
    parentRequest: NetworkRequest
  ): void {
    const id = `req_${++this.requestId}`;
    const startTime = Date.now();

    // Parse HTTP request from data
    const dataStr = data.toString();
    const lines = dataStr.split('\r\n');
    const [method, path] = (lines[0] || '').split(' ');

    const headers: Record<string, string> = {};
    let bodyStart = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '') {
        bodyStart = i + 1;
        break;
      }
      const [key, ...valueParts] = lines[i].split(':');
      if (key) {
        headers[key.toLowerCase()] = valueParts.join(':').trim();
      }
    }

    const body = lines.slice(bodyStart).join('\r\n');

    const request: NetworkRequest = {
      id,
      method: method || 'GET',
      url: `https://${hostname}${path}`,
      headers,
      body: body || undefined,
      timestamp: startTime,
    };

    this.emit('request', request);

    // Make request to actual server
    const options: https.RequestOptions = {
      hostname,
      port,
      path,
      method,
      headers,
      rejectUnauthorized: false,
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let responseBody = '';

      proxyRes.on('data', (chunk) => {
        responseBody += chunk.toString();
      });

      proxyRes.on('end', () => {
        request.response = {
          status: proxyRes.statusCode || 0,
          statusText: proxyRes.statusMessage || '',
          headers: proxyRes.headers as Record<string, string>,
          body: responseBody,
          duration: Date.now() - startTime,
        };

        this.emit('response', request);

        // Send response back to client
        let response = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value) {
            response += `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`;
          }
        }
        response += '\r\n';
        response += responseBody;

        clientSocket.write(response);
      });
    });

    proxyReq.on('error', (err) => {
      this.emit('error', { id, error: err.message });
    });

    if (body) {
      proxyReq.write(body);
    }
    proxyReq.end();
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  getCACertPath(): string | null {
    return this.caCert ? getCACertPath() : null;
  }
}

let proxyInstance: ProxyServer | null = null;

export function startProxy(port: number): Promise<void> {
  proxyInstance = new ProxyServer();
  return proxyInstance.start(port);
}

export function getProxyInstance(): ProxyServer | null {
  return proxyInstance;
}

export function stopProxy(): void {
  proxyInstance?.stop();
  proxyInstance = null;
}

export function getProxyCACertPath(): string | null {
  return proxyInstance?.getCACertPath() || null;
}
