import { createHash, createHmac, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";

const ACCESS_KEY = "4d11b6b9d5ea4d19a829adbb9714b057";
const SECRET = "6ed7d97f3e73467f8a5bab90b577ba4c";
const ENTRY = "https://n-wap-gw.tplinkcloud.com";
const tplinkCa = `-----BEGIN CERTIFICATE-----
MIIDBzCCAe+gAwIBAgIQT5x0ma7QnINHCQvhnmzR9zANBgkqhkiG9w0BAQsFADAV
MRMwEQYDVQQDEwp0cC1saW5rLUNBMCAXDTE4MDExOTA4Mjc1MloYDzIwNjgwMTE5
MDgzNzUyWjAVMRMwEQYDVQQDEwp0cC1saW5rLUNBMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAuGG8n5zEUN1j5wuvUz4pAIMurhKHbpfUUu+b2acFHKS6
iU9hNJWvDyhXcihY5Wz6aq9m4D5SZcgW3k31YoNNtrztDjdg2qw7AaX85S99/G0B
VbIXktrhs34OW19WA/haDwut3dFhLem+gCRRKUXcmuqchZc84dY7JFVfhPcJci4m
sRjLCFNO0ho9OX+MZwfO4BLaeAqKVoAor6rf4BXVtO0xjYHDKO0fb3AWLLJ4EjGe
q6YieqPiYlPFEqRm5PrvBXTm0IuQogygyVpK4LHr/K207ZLyV33DxLLbsUgSEJVn
pZUv/WUujXjlIDgxIvyZZCYiXO3dle2/MEvpmZk6JQIDAQABo1EwTzALBgNVHQ8E
BAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUxu2iBRTsef5iNnsADVhM
JDQWi6kwEAYJKwYBBAGCNxUBBAMCAQAwDQYJKoZIhvcNAQELBQADggEBAB52Majd
+wo3cb5BsTo63z2Psbbyl4ACMUaw68NxUMy61Oihx3mcLzLJqiIZcKePiHskLqLJ
F7QfT9TqjvizMjFJVgsLuVubUBXKBzqyN+3KKlQci0PO3mH+ObhyaE7BzV+qrS3P
dVTgsCWFv8DkgLTRudSWxL7VwVoedc7lRz5EroGgJ33nRGCR0ngcW919tLTARDQO
pULmzulcdWeZgG+0PLX0xjJQIjFEvbOxR1Z+gxMupBz0rWFokmWYrcga8eWiWzjQ
Ia3/ASBVJ69srV77trWlfLumkChbXk9i64NXBKnce0Jmll0Y9OC1nMPqrbQKnzcn
dSAA4fejD/qMQn0=
-----END CERTIFICATE-----
`;

export type CloudCamera = {
  id: string;
  name: string;
  model: string;
  host: string;
};

export type CloudSession =
  | { ok: true; cameras: CloudCamera[] }
  | { ok: false; error: string; mfa: boolean };

type PendingLogin = {
  email: string;
  password: string;
  terminalUUID: string;
  base: string;
  processId: string;
};

let pending: PendingLogin | null = null;

type CloudBody = Record<string, unknown>;

function errorCode(body: CloudBody): number {
  const raw = body.error_code ?? body.errorCode ?? 0;
  const code = Number(raw);
  return Number.isFinite(code) ? code : 1;
}

function messageFor(code: number): string {
  if (code === -20601 || code === -20675 || code === -20615 || code === -20580) {
    return "Email or password was rejected.";
  }
  if (code === -20202) return "Tapo account was not found.";
  return `Tapo rejected the connection (${code}).`;
}

function contentMd5(body: string): string {
  return createHash("md5").update(body, "utf8").digest("base64");
}

function authorization(body: string, endpoint: string): { md5: string; header: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const md5 = contentMd5(body);
  const signature = createHmac("sha1", SECRET).update(`${md5}\n${timestamp}\n${nonce}\n${endpoint}`, "utf8").digest("hex");
  return {
    md5,
    header: `Timestamp=${timestamp}, Nonce=${nonce}, AccessKey=${ACCESS_KEY}, Signature=${signature}`,
  };
}

function postHttps(url: URL, body: string, headers: Record<string, string>): Promise<string> {
  if (!url.hostname.endsWith(".tplinkcloud.com")) {
    return Promise.reject(new Error("Tapo sunucu adresi geçersiz."));
  }
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        ca: tplinkCa,
        servername: url.hostname,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Tapo sunucusu zaman aşımına uğradı."));
    });
    req.on("error", () => reject(new Error("Tapo sunucusuna ulaşılamadı. İnternet bağlantısını kontrol et.")));
    req.end(body);
  });
}

async function postCloud(base: string, endpoint: string, payload: unknown, token?: string): Promise<CloudBody> {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signed = authorization(body, endpoint);
  const url = new URL(base.replace(/\/$/, "") + endpoint);
  if (token) url.searchParams.set("token", token);
  const text = await postHttps(url, body, {
    "Content-Md5": signed.md5,
    "X-Authorization": signed.header,
    "Content-Type": "application/json; charset=UTF-8",
    "User-Agent": "okhttp/3.12.13",
  });
  try {
    return JSON.parse(text) as CloudBody;
  } catch {
    throw new Error("Could not read the Tapo server.");
  }
}

function resultOf(body: CloudBody): CloudBody {
  return body.result && typeof body.result === "object" ? (body.result as CloudBody) : {};
}

function loginPayload(email: string, password: string, terminalUUID: string) {
  return {
    appType: "TP-Link_Tapo_Android",
    appVersion: "2.12.705",
    cloudPassword: password,
    cloudUserName: email,
    platform: "Android 12",
    refreshTokenNeeded: false,
    terminalMeta: "1",
    terminalName: "Tapo Ses",
    terminalUUID,
  };
}

function failureCode(body: CloudBody): number {
  const outer = errorCode(body);
  if (outer !== 0) return outer;
  return errorCode(resultOf(body));
}

async function loginAt(base: string, email: string, password: string, terminalUUID: string): Promise<{ base: string; body: CloudBody }> {
  let current = base;
  let body = await postCloud(current, "/api/v2/account/login", loginPayload(email, password, terminalUUID));
  if (failureCode(body) === -20212) {
    const next = String(resultOf(body).appServerUrl ?? body.appServerUrl ?? "");
    if (next.startsWith("https://") && next.replace(/\/$/, "") !== current) {
      current = next.replace(/\/$/, "");
      body = await postCloud(current, "/api/v2/account/login", loginPayload(email, password, terminalUUID));
    }
  }
  return { base: current, body };
}

function modelId(raw: string): string {
  const match = raw.toUpperCase().match(/C\d{3}WS|C\d{3}W|C\d{3}|D\d{3}/);
  return match?.[0] ?? "C210";
}

function camerasFrom(body: CloudBody): CloudCamera[] {
  const list = resultOf(body).deviceList;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const device = item as CloudBody;
    const type = String(device.deviceType ?? "");
    if (type && !type.includes("CAMERA")) return [];
    const model = modelId(String(device.deviceModel ?? device.deviceName ?? device.alias ?? ""));
    const host = String(device.ip ?? "").trim();
    const name = String(device.alias || device.deviceName || model);
    const id = String(device.deviceId || `${name}-${host || model}`);
    return [{ id, name, model, host: /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host : "" }];
  });
}

async function camerasFor(base: string, token: string): Promise<CloudCamera[]> {
  const body = await postCloud(
    base,
    "/api/v2/common/getDeviceListByPage",
    JSON.stringify({
      deviceTypeList: ["SMART.IPCAMERA"],
      index: 0,
      limit: 20,
    }),
    token,
  );
  const code = failureCode(body);
  if (code !== 0) throw new Error(messageFor(code));
  return camerasFrom(body);
}

export async function connectTapoAccount(input: {
  email: string;
  password: string;
  code?: string;
}): Promise<CloudSession> {
  const email = input.email.trim();
  const password = input.password;
  if (!email.includes("@") || !password) {
    return { ok: false, mfa: false, error: "Tapo e-postası ve şifresi gerekli." };
  }

  if (input.code?.trim()) {
    if (!pending || pending.email !== email) {
      return { ok: false, mfa: true, error: "Doğrulama süresi doldu. Şifreyi yeniden gir." };
    }
    const body = await postCloud(pending.base, "/api/v2/account/checkMFACodeAndLogin", {
      appType: "TP-Link_Tapo_Android",
      cloudUserName: email,
      code: input.code.trim(),
      MFAProcessId: pending.processId,
      MFAType: 2,
      terminalBindEnabled: true,
    });
    if (errorCode(body) !== 0) return { ok: false, mfa: true, error: messageFor(errorCode(body)) };
    const token = String(resultOf(body).token ?? "");
    if (!token) return { ok: false, mfa: true, error: "Doğrulama kodu kabul edilmedi." };
    const cameras = await camerasFor(pending.base, token);
    pending = null;
    return { ok: true, cameras };
  }

  const terminalUUID = randomUUID().replace(/-/g, "").toUpperCase();
  const { base, body } = await loginAt(ENTRY, email, password, terminalUUID);
  const result = resultOf(body);
  const code = failureCode(body);
  if (code !== 0) return { ok: false, mfa: false, error: messageFor(code) };

  const processId = String(result.MFAProcessId ?? "");
  if (processId) {
    pending = { email, password, terminalUUID, base, processId };
    await postCloud(base, "/api/v2/account/getEmailVC4TerminalMFA", {
      appType: "TP-Link_Tapo_Android",
      cloudPassword: password,
      cloudUserName: email,
      terminalUUID,
    }).catch(() => undefined);
    return { ok: false, mfa: true, error: "Tapo e-postana bir doğrulama kodu gönderdi. Kodu yaz." };
  }

  const token = String(result.token ?? "");
  if (!token) return { ok: false, mfa: false, error: "Tapo oturum açmadı." };
  pending = null;
  return { ok: true, cameras: await camerasFor(base, token) };
}
