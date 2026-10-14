package com.ruzgar.taposes

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { TapoApp(this) }
    }
}

private val Talk = Color(0xFFC4342A)
private val Page = Color(0xFFECEAE4)
private val Ink = Color(0xFF1C1B19)
private val Muted = Color(0xFF6B6760)
private val Paper = Color(0xFFF7F6F3)

private data class Camera(val id: String, val name: String, val model: String, val host: String)
private data class Account(val email: String, val password: String)

@Composable
private fun TapoApp(activity: Activity) {
    val english = !activity.resources.configuration.locales[0].language.startsWith("tr")
    fun t(en: String, tr: String) = if (english) en else tr
    val prefs = activity.getSharedPreferences("tapo-ses", Context.MODE_PRIVATE)
    var account by remember { mutableStateOf(loadAccount(prefs)) }
    var cameras by remember { mutableStateOf(loadCameras(prefs)) }
    var selected by remember { mutableStateOf(cameras.firstOrNull()?.id ?: "") }
    var email by remember { mutableStateOf(account?.email ?: "") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var needsCode by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val cancel = remember { AtomicBoolean(false) }
    var volume by remember { mutableFloatStateOf(100f) }
    var sound by remember { mutableStateOf<Uri?>(null) }
    var soundName by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var host by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            runCatching {
                activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            sound = uri
            soundName = uri.lastPathSegment?.substringAfterLast('/') ?: "audio"
        }
    }
    LaunchedEffect(account?.email) {
        if (account == null) return@LaunchedEffect
        val previous = status
        status = if (english) "Looking for the camera…" else "Kamera aranıyor…"
        val ips = withContext(Dispatchers.IO) { discoverCameraAddresses(activity) }
        if (ips.isEmpty()) {
            if (cameras.none { it.host.isNotBlank() }) {
                status = if (english) "No camera found on this network." else "Bu ağda kamera bulunamadı."
            } else {
                status = previous
            }
            return@LaunchedEffect
        }
        val filled = assignAddresses(cameras, ips)
        cameras = filled
        saveCameras(prefs, filled)
        selected = filled.firstOrNull { it.host.isNotBlank() }?.id ?: selected
        if (host.isBlank()) host = ips.first()
        status = if (english) "Camera address ${filled.firstOrNull { it.host.isNotBlank() }?.host ?: ips.first()}" else "Kamera adresi ${filled.firstOrNull { it.host.isNotBlank() }?.host ?: ips.first()}"
    }

    MaterialTheme(colorScheme = lightColorScheme(primary = Talk, background = Page, surface = Paper)) {
        Surface(modifier = Modifier.fillMaxSize(), color = Page) {
            if (account == null) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(t("Tapo Ses", "Tapo Ses"), fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                    Text(t("Sign in with the Tapo account that owns the camera.", "Kameranın bağlı olduğu Tapo hesabıyla giriş yap."), color = Muted)
                    OutlinedTextField(email, { email = it }, label = { Text(t("Email", "E-posta")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    OutlinedTextField(password, { password = it }, label = { Text(t("Password", "Şifre")) }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(), singleLine = true)
                    if (needsCode) {
                        OutlinedTextField(code, { code = it }, label = { Text(t("Email code", "E-posta kodu")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    }
                    Button(
                        onClick = {
                            busy = true
                            status = t("Connecting…", "Bağlanıyor…")
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { TapoCloud.connect(email, password, code.ifBlank { null }, english) }
                                busy = false
                                when (result) {
                                    is CloudResult.Ok -> {
                                        account = Account(email.trim(), password)
                                        saveAccount(prefs, account!!)
                                        if (result.cameras.isNotEmpty()) {
                                            cameras = result.cameras.map { Camera(it.id, it.name, it.model, it.host) }
                                            saveCameras(prefs, cameras)
                                            selected = cameras.first().id
                                        }
                                        status = ""
                                    }
                                    is CloudResult.Fail -> {
                                        needsCode = result.needsCode
                                        status = result.message
                                    }
                                }
                            }
                        },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = Talk),
                    ) { Text(if (needsCode) t("Verify", "Doğrula") else t("Sign in", "Giriş")) }
                    if (status.isNotEmpty()) Text(status, color = Ink)
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    Row(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Tapo Ses", fontWeight = FontWeight.SemiBold, color = Ink)
                        Text(t("Sign out", "Çıkış"), color = Talk, modifier = Modifier.clickable {
                            account = null
                            prefs.edit().remove("account").apply()
                        })
                    }
                    LazyColumn(Modifier.weight(1f).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(cameras) { camera ->
                            Column(
                                Modifier.fillMaxWidth().background(if (camera.id == selected) Color(0xFFD5E4F2) else Color.White, RoundedCornerShape(10.dp)).clickable { selected = camera.id }.padding(12.dp),
                            ) {
                                Text(camera.name, fontWeight = FontWeight.Medium, color = Ink)
                                Text("${camera.model}  ${camera.host.ifBlank { t("No address", "Adres yok") }}", color = Muted, fontSize = 13.sp)
                            }
                        }
                        item {
                            Spacer(Modifier.height(8.dp))
                            Text(t("Add camera", "Kamera ekle"), fontWeight = FontWeight.Medium)
                            OutlinedTextField(name, { name = it }, label = { Text(t("Name", "Ad")) }, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(host, { host = it }, label = { Text(t("Address", "Adres")) }, modifier = Modifier.fillMaxWidth())
                            Button(onClick = {
                                if (host.isBlank()) {
                                    status = t("Enter the camera address.", "Kamera adresini yaz.")
                                } else {
                                    val camera = Camera(java.util.UUID.randomUUID().toString(), name.ifBlank { "C210" }, "C210", host.trim())
                                    cameras = cameras + camera
                                    selected = camera.id
                                    saveCameras(prefs, cameras)
                                    name = ""
                                    host = ""
                                }
                            }, colors = ButtonDefaults.buttonColors(containerColor = Talk)) { Text(t("Add", "Ekle")) }
                        }
                    }
                    Column(Modifier.background(Paper).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(soundName.ifBlank { t("No audio selected", "Ses seçilmedi") }, color = Ink)
                        Text(t("Level ${volume.toInt()}", "Seviye ${volume.toInt()}"), color = Muted, fontSize = 13.sp)
                        Slider(volume, { volume = it }, valueRange = 0f..150f)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { picker.launch(arrayOf("audio/*")) }) { Text(t("Audio", "Ses")) }
                            Button(onClick = {
                                val camera = cameras.find { it.id == selected }
                                val file = sound
                                val signed = account
                                when {
                                    camera == null || camera.host.isBlank() -> status = t("Choose a camera with an address.", "Adresi olan bir kamera seç.")
                                    file == null -> status = t("Choose an audio file.", "Bir ses dosyası seç.")
                                    signed == null -> status = ""
                                    else -> {
                                        cancel.set(false)
                                        busy = true
                                        status = t("Sending…", "Gönderiliyor…")
                                        scope.launch {
                                            val message = withContext(Dispatchers.IO) {
                                                runCatching {
                                                    val ms = playFileOnCamera(activity, file, camera.host, signed.password, volume.toInt(), english, { cancel.get() }) { part, total ->
                                                        if (total > 1) {
                                                            val text = if (english) "Part $part of $total…" else "Parça $part / $total…"
                                                            android.os.Handler(android.os.Looper.getMainLooper()).post { status = text }
                                                        }
                                                    }
                                                    if (cancel.get()) t("Stopped.", "Durduruldu.")
                                                    else t("Played on ${camera.name} (${ms / 1000}s).", "${camera.name} üzerinden çalındı (${ms / 1000} sn).")
                                                }.getOrElse { error ->
                                                    val text = error.message ?: t("Playback failed.", "Ses çalınamadı.")
                                                    if (text.contains("Stopped") || text.contains("Durduruldu")) t("Stopped.", "Durduruldu.") else text
                                                }
                                            }
                                            busy = false
                                            status = message
                                        }
                                    }
                                }
                            }, enabled = !busy, shape = CircleShape, modifier = Modifier.size(64.dp), colors = ButtonDefaults.buttonColors(containerColor = Talk)) { Text(if (busy) "■" else "▶") }
                            OutlinedButton(onClick = { cancel.set(true) }, enabled = busy) { Text(t("Stop", "Durdur")) }
                        }
                        if (status.isNotEmpty()) Text(status, color = Ink)
                    }
                }
            }
        }
    }
}

private fun assignAddresses(cameras: List<Camera>, ips: List<String>): List<Camera> {
    if (ips.isEmpty()) return cameras
    if (cameras.isEmpty()) {
        return ips.map { Camera(java.util.UUID.randomUUID().toString(), "C210", "C210", it) }
    }
    val unused = ips.toMutableList()
    return cameras.map { camera ->
        if (camera.host.isNotBlank()) {
            unused.remove(camera.host)
            camera
        } else {
            val ip = unused.removeFirstOrNull() ?: return@map camera
            camera.copy(host = ip)
        }
    }
}

private fun loadAccount(prefs: android.content.SharedPreferences): Account? {
    val raw = prefs.getString("account", null) ?: return null
    val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
    val email = json.optString("email")
    val password = json.optString("password")
    return if (email.contains("@") && password.isNotEmpty()) Account(email, password) else null
}

private fun saveAccount(prefs: android.content.SharedPreferences, account: Account) {
    prefs.edit().putString("account", JSONObject().put("email", account.email).put("password", account.password).toString()).apply()
}

private fun loadCameras(prefs: android.content.SharedPreferences): List<Camera> {
    val raw = prefs.getString("cameras", null) ?: return emptyList()
    val list = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
    return buildList {
        for (i in 0 until list.length()) {
            val item = list.optJSONObject(i) ?: continue
            add(Camera(item.optString("id"), item.optString("name"), item.optString("model"), item.optString("host")))
        }
    }
}

private fun saveCameras(prefs: android.content.SharedPreferences, cameras: List<Camera>) {
    val list = JSONArray()
    cameras.forEach { list.put(JSONObject().put("id", it.id).put("name", it.name).put("model", it.model).put("host", it.host)) }
    prefs.edit().putString("cameras", list.toString()).apply()
}
