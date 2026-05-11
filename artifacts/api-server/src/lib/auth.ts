import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticator } from "@otplib/preset-default";
import QRCode from "qrcode";

const SALT_ROUNDS = 12;
const JWT_SECRET = process.env.SESSION_SECRET ?? "changeme-in-production";
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
const TEMP_TOKEN_TTL = "5m";

export interface JwtPayload {
  sub: number;
  email: string;
  roleId: number;
  roleName: string;
  type: "access" | "refresh" | "temp";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

export function signTempToken(payload: Omit<JwtPayload, "type">): string {
  return jwt.sign({ ...payload, type: "temp" }, JWT_SECRET, { expiresIn: TEMP_TOKEN_TTL });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function generateMfaSecret(): string {
  return authenticator.generateSecret(20);
}

export async function generateMfaQrCode(email: string, secret: string): Promise<string> {
  const otpauthUrl = authenticator.keyuri(email, "Ashika Platform", secret);
  return QRCode.toDataURL(otpauthUrl);
}

export function getMfaOtpAuthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, "Ashika Platform", secret);
}

export function verifyMfaToken(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

export function getRefreshTokenExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}
