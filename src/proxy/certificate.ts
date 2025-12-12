import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CERT_DIR = path.join(os.homedir(), '.devlens', 'certs');
const CA_KEY = path.join(CERT_DIR, 'ca.key');
const CA_CERT = path.join(CERT_DIR, 'ca.crt');

export interface CertPaths {
  key: string;
  cert: string;
  dir: string;
}

export function ensureCertDir(): void {
  if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
  }
}

export function generateCACert(): CertPaths {
  ensureCertDir();

  if (fs.existsSync(CA_KEY) && fs.existsSync(CA_CERT)) {
    return { key: CA_KEY, cert: CA_CERT, dir: CERT_DIR };
  }

  // Generate CA private key
  execSync(`openssl genrsa -out "${CA_KEY}" 2048`, { stdio: 'pipe' });

  // Generate CA certificate
  execSync(
    `openssl req -x509 -new -nodes -key "${CA_KEY}" -sha256 -days 1825 -out "${CA_CERT}" -subj "/C=US/ST=State/L=City/O=DevLens/CN=DevLens CA"`,
    { stdio: 'pipe' }
  );

  return { key: CA_KEY, cert: CA_CERT, dir: CERT_DIR };
}

export function generateHostCert(hostname: string): { key: string; cert: string } {
  ensureCertDir();

  const hostKey = path.join(CERT_DIR, `${hostname}.key`);
  const hostCert = path.join(CERT_DIR, `${hostname}.crt`);

  if (fs.existsSync(hostKey) && fs.existsSync(hostCert)) {
    return { key: hostKey, cert: hostCert };
  }

  // Generate host private key
  execSync(`openssl genrsa -out "${hostKey}" 2048`, { stdio: 'pipe' });

  // Generate CSR
  const csrPath = path.join(CERT_DIR, `${hostname}.csr`);
  execSync(
    `openssl req -new -key "${hostKey}" -out "${csrPath}" -subj "/C=US/ST=State/L=City/O=DevLens/CN=${hostname}"`,
    { stdio: 'pipe' }
  );

  // Create ext file for SAN
  const extPath = path.join(CERT_DIR, `${hostname}.ext`);
  fs.writeFileSync(
    extPath,
    `authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${hostname}
`
  );

  // Sign with CA
  execSync(
    `openssl x509 -req -in "${csrPath}" -CA "${CA_CERT}" -CAkey "${CA_KEY}" -CAcreateserial -out "${hostCert}" -days 825 -sha256 -extfile "${extPath}"`,
    { stdio: 'pipe' }
  );

  // Cleanup
  fs.unlinkSync(csrPath);
  fs.unlinkSync(extPath);

  return { key: hostKey, cert: hostCert };
}

export function getCACertPath(): string {
  return CA_CERT;
}

export function isCACertGenerated(): boolean {
  return fs.existsSync(CA_CERT);
}
