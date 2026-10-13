import { createHash, randomBytes } from "node:crypto";

export type DigestChallenge = {
  realm: string;
  nonce: string;
  qop: string;
  opaque: string;
  encryptType: "md5" | "sha256";
};

export function hashCloudPassword(
  password: string,
  encryptType: "md5" | "sha256",
): string {
  return createHash(encryptType).update(password, "utf8").digest("hex").toUpperCase();
}

export function parseDigestChallenge(header: string): DigestChallenge {
  const fields = new Map<string, string>();
  const pattern = /([a-zA-Z0-9_]+)=(?:"([^"]*)"|([^,\s]+))/g;
  for (const match of header.matchAll(pattern)) {
    fields.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? "");
  }
  const encrypt = fields.get("encrypt_type");
  return {
    realm: fields.get("realm") ?? "",
    nonce: fields.get("nonce") ?? "",
    qop: (fields.get("qop") ?? "").split(",")[0]?.trim() ?? "",
    opaque: fields.get("opaque") ?? "",
    encryptType: encrypt === "3" ? "sha256" : "md5",
  };
}

function md5(value: string): string {
  return createHash("md5").update(value, "utf8").digest("hex");
}

export function buildDigestAuthorization(input: {
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: DigestChallenge;
  cnonce?: string;
}): string {
  const cnonce = input.cnonce ?? randomBytes(16).toString("hex");
  const nc = "00000001";
  const ha1 = md5(`${input.username}:${input.challenge.realm}:${input.password}`);
  const ha2 = md5(`${input.method}:${input.uri}`);
  const qop = input.challenge.qop;
  const response = qop
    ? md5(`${ha1}:${input.challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${input.challenge.nonce}:${ha2}`);

  let header =
    `Digest username="${input.username}", realm="${input.challenge.realm}", ` +
    `nonce="${input.challenge.nonce}", uri="${input.uri}"`;
  if (qop) {
    header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  } else {
    header += `, response="${response}"`;
  }
  if (input.challenge.opaque) {
    header += `, opaque="${input.challenge.opaque}", algorithm=MD5`;
  }
  return header;
}
