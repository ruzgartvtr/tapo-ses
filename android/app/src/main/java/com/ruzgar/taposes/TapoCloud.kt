package com.ruzgar.taposes

import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import org.json.JSONObject

data class CloudCamera(val id: String, val name: String, val model: String, val host: String)

sealed class CloudResult {
    data class Ok(val cameras: List<CloudCamera>) : CloudResult()
    data class Fail(val message: String, val needsCode: Boolean = false) : CloudResult()
}

object TapoCloud {
    private const val ENTRY = "https://n-wap-gw.tplinkcloud.com"
    private const val ACCESS_KEY = "4d11b6b9d5ea4d19a829adbb9714b057"
    private const val SECRET = "6ed7d97f3e73467f8a5bab90b577ba4c"
    private var pending: Pending? = null

    private data class Pending(val email: String, val base: String, val processId: String)

    fun connect(email: String, password: String, code: String?, english: Boolean): CloudResult {
        if (!email.contains("@") || password.isEmpty()) {
            return CloudResult.Fail(if (english) "Enter your Tapo email and password." else "Tapo e-postası ve şifresi gerekli.")
        }
        if (!code.isNullOrBlank()) {
            val held = pending
            if (held == null || held.email != email.trim()) {
                return CloudResult.Fail(if (english) "The code expired. Sign in again." else "Doğrulama süresi doldu. Yeniden giriş yap.", true)
            }
            val body = post(held.base, "/api/v2/account/checkMFACodeAndLogin", JSONObject()
                .put("appType", "TP-Link_Tapo_Android")
                .put("cloudUserName", email.trim())
                .put("code", code.trim())
                .put("MFAProcessId", held.processId)
                .put("MFAType", 2)
                .put("terminalBindEnabled", true))
            if (failure(body) != 0) return CloudResult.Fail(message(failure(body), english), true)
            val token = body.optJSONObject("result")?.optString("token").orEmpty()
            if (token.isEmpty()) return CloudResult.Fail(if (english) "The code was rejected." else "Kod kabul edilmedi.", true)
            pending = null
            return CloudResult.Ok(cameras(held.base, token))
        }
        val terminal = UUID.randomUUID().toString().replace("-", "").uppercase()
        val login = loginAt(email.trim(), password, terminal)
        val codeNum = failure(login.body)
        if (codeNum != 0) return CloudResult.Fail(message(codeNum, english))
        val result = login.body.optJSONObject("result") ?: JSONObject()
        val processId = result.optString("MFAProcessId")
        if (processId.isNotEmpty()) {
            pending = Pending(email.trim(), login.base, processId)
            runCatching {
                post(login.base, "/api/v2/account/getEmailVC4TerminalMFA", JSONObject()
                    .put("appType", "TP-Link_Tapo_Android")
                    .put("cloudPassword", password)
                    .put("cloudUserName", email.trim())
                    .put("terminalUUID", terminal))
            }
            return CloudResult.Fail(if (english) "Tapo sent a verification code to your email." else "Tapo e-postana bir doğrulama kodu gönderdi.", true)
        }
        val token = result.optString("token")
        if (token.isEmpty()) return CloudResult.Fail(if (english) "Tapo did not start a session." else "Tapo oturum açmadı.")
        return CloudResult.Ok(cameras(login.base, token))
    }

    private fun cameras(base: String, token: String): List<CloudCamera> {
        val body = post(
            base,
            "/api/v2/common/getDeviceListByPage",
            JSONObject()
                .put("deviceTypeList", org.json.JSONArray(listOf("SMART.IPCAMERA")))
                .put("index", 0)
                .put("limit", 20),
            token,
        )
        val code = failure(body)
        if (code != 0) throw IllegalStateException(message(code, true))
        val list = body.optJSONObject("result")?.optJSONArray("deviceList") ?: return emptyList()
        val cameras = mutableListOf<CloudCamera>()
        for (i in 0 until list.length()) {
            val device = list.optJSONObject(i) ?: continue
            val type = device.optString("deviceType")
            if (type.isNotEmpty() && !type.contains("CAMERA")) continue
            val raw = listOf(device.optString("deviceModel"), device.optString("deviceName"), device.optString("alias")).joinToString(" ")
            val model = Regex("C\\d{3}WS|C\\d{3}W|C\\d{3}|D\\d{3}").find(raw.uppercase())?.value ?: "C210"
            val host = device.optString("ip").trim()
            val name = device.optString("alias").ifBlank { device.optString("deviceName").ifBlank { model } }
            val id = device.optString("deviceId").ifBlank { "$name-$host" }
            cameras += CloudCamera(id, name, model, if (host.matches(Regex("\\d{1,3}(\\.\\d{1,3}){3}"))) host else "")
        }
        return cameras
    }

    private data class Login(val base: String, val body: JSONObject)

    private fun loginAt(email: String, password: String, terminal: String): Login {
        var base = ENTRY
        var body = post(base, "/api/v2/account/login", loginJson(email, password, terminal))
        if (failure(body) == -20212) {
            val next = body.optJSONObject("result")?.optString("appServerUrl").orEmpty().ifBlank { body.optString("appServerUrl") }
            if (next.startsWith("https://") && next.trimEnd('/') != base) {
                base = next.trimEnd('/')
                body = post(base, "/api/v2/account/login", loginJson(email, password, terminal))
            }
        }
        return Login(base, body)
    }

    private fun loginJson(email: String, password: String, terminal: String) = JSONObject()
        .put("appType", "TP-Link_Tapo_Android")
        .put("appVersion", "2.12.705")
        .put("cloudPassword", password)
        .put("cloudUserName", email)
        .put("platform", "Android 12")
        .put("refreshTokenNeeded", false)
        .put("terminalMeta", "1")
        .put("terminalName", "Tapo Ses")
        .put("terminalUUID", terminal)

    private fun failure(body: JSONObject): Int {
        val outer = body.optInt("error_code", body.optInt("errorCode", 0))
        if (outer != 0) return outer
        val result = body.optJSONObject("result") ?: return 0
        return result.optInt("error_code", result.optInt("errorCode", 0))
    }

    private fun message(code: Int, english: Boolean): String = when (code) {
        -20601, -20675, -20615, -20580 -> if (english) "Email or password was rejected." else "E-posta veya şifre kabul edilmedi."
        -20202 -> if (english) "Tapo account was not found." else "Tapo hesabı bulunamadı."
        else -> if (english) "Tapo rejected the connection ($code)." else "Tapo bağlantıyı reddetti ($code)."
    }

    private fun post(base: String, endpoint: String, payload: JSONObject, token: String? = null): JSONObject {
        val body = payload.toString()
        val md5 = md5Base64(body)
        val timestamp = (System.currentTimeMillis() / 1000).toString()
        val nonce = UUID.randomUUID().toString()
        val signature = hmacSha1(SECRET, "$md5\n$timestamp\n$nonce\n$endpoint")
        val url = URL(base.trimEnd('/') + endpoint + (token?.let { "?token=$it" } ?: ""))
        if (!url.host.endsWith(".tplinkcloud.com")) error("Unexpected host")
        val connection = (url.openConnection() as HttpsURLConnection).apply {
            sslSocketFactory = trust().socketFactory
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Md5", md5)
            setRequestProperty("X-Authorization", "Timestamp=$timestamp, Nonce=$nonce, AccessKey=$ACCESS_KEY, Signature=$signature")
            setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            setRequestProperty("User-Agent", "okhttp/3.12.13")
            connectTimeout = 15000
            readTimeout = 15000
        }
        connection.outputStream.use { it.write(body.toByteArray()) }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream.bufferedReader().readText()
        return JSONObject(text)
    }

    private fun trust(): SSLContext {
        val cert = CertificateFactory.getInstance("X.509").generateCertificate(CA.byteInputStream()) as X509Certificate
        val store = java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType())
        store.load(null)
        store.setCertificateEntry("tplink", cert)
        val trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        trust.init(store)
        return SSLContext.getInstance("TLS").apply { init(null, trust.trustManagers, SecureRandom()) }
    }

    private fun md5Base64(value: String): String =
        android.util.Base64.encodeToString(MessageDigest.getInstance("MD5").digest(value.toByteArray()), android.util.Base64.NO_WRAP)

    private fun hmacSha1(key: String, value: String): String {
        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA1"))
        return mac.doFinal(value.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private const val CA = """-----BEGIN CERTIFICATE-----
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
"""
}
