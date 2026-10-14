package com.ruzgar.taposes

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import kotlin.math.min
import kotlin.math.roundToInt

private const val FRAME = 160
private const val RATE = 8000
private const val MAX_SECONDS = 90

fun playFileOnCamera(
    context: Context,
    uri: Uri,
    host: String,
    password: String,
    volume: Int,
    english: Boolean,
    cancelled: () -> Boolean,
): Int {
    val alaw = fileToAlaw(context, uri, volume, english)
    return playAlaw(host, password, alaw, english, cancelled)
}

fun fileToAlaw(context: Context, uri: Uri, volume: Int, english: Boolean): ByteArray {
    val extractor = MediaExtractor()
    try {
        extractor.setDataSource(context, uri, null)
        var track = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val candidate = extractor.getTrackFormat(i)
            if (candidate.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
                track = i
                format = candidate
                break
            }
        }
        if (track < 0 || format == null) error(if (english) "That file has no audio." else "Dosyada ses yok.")
        extractor.selectTrack(track)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
        val decoded = if (mime == "audio/raw" || mime == "audio/wav" || mime == "audio/x-wav") {
            Decoded(readPcm(extractor), decoderOutput(format).sampleRate, decoderOutput(format).channels)
        } else {
            decodeCompressed(extractor, format, mime, english)
        }
        if (decoded.pcm.isEmpty()) error(if (english) "That file has no audio." else "Dosyada ses yok.")
        return resampleToAlaw(decoded, volume)
    } catch (error: IllegalStateException) {
        throw error
    } catch (error: Exception) {
        throw IllegalStateException(if (english) "The audio file could not be read." else "Ses dosyası okunamadı.", error)
    } finally {
        extractor.release()
    }
}

private data class Decoded(val pcm: List<Short>, val sampleRate: Int, val channels: Int)

private fun readPcm(extractor: MediaExtractor): List<Short> {
    val pcm = ArrayList<Short>()
    val buffer = java.nio.ByteBuffer.allocate(64 * 1024).order(ByteOrder.LITTLE_ENDIAN)
    while (pcm.size < RATE * MAX_SECONDS) {
        buffer.clear()
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        buffer.position(0)
        buffer.limit(size)
        while (buffer.remaining() >= 2 && pcm.size < RATE * MAX_SECONDS) pcm.add(buffer.short)
        extractor.advance()
    }
    return pcm
}

private fun decodeCompressed(extractor: MediaExtractor, format: MediaFormat, mime: String, english: Boolean): Decoded {
    if (!format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    val decoder = MediaCodec.createDecoderByType(mime)
    var sampleRate = decoderOutput(format).sampleRate
    var channels = decoderOutput(format).channels
    val pcm = ArrayList<Short>()
    try {
        decoder.configure(format, null, null, 0)
        decoder.start()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        val deadline = System.currentTimeMillis() + 20_000
        while (!outputDone && pcm.size < RATE * MAX_SECONDS && System.currentTimeMillis() < deadline) {
            if (!inputDone) {
                val index = decoder.dequeueInputBuffer(10_000)
                if (index >= 0) {
                    val buffer = decoder.getInputBuffer(index)!!
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) {
                        decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }
            when (val index = decoder.dequeueOutputBuffer(info, 10_000)) {
                MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val out = decoder.outputFormat
                    if (out.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE).coerceAtLeast(8000)
                    if (out.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
                }
                else -> if (index >= 0) {
                    if (info.size > 0) {
                        val buffer = decoder.getOutputBuffer(index)!!
                        buffer.order(ByteOrder.LITTLE_ENDIAN)
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        while (buffer.remaining() >= 2 && pcm.size < RATE * MAX_SECONDS) pcm.add(buffer.short)
                    }
                    outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    decoder.releaseOutputBuffer(index, false)
                }
            }
        }
    } catch (error: Exception) {
        throw IllegalStateException(if (english) "The audio file could not be read." else "Ses dosyası okunamadı.", error)
    } finally {
        runCatching { decoder.stop() }
        runCatching { decoder.release() }
    }
    return Decoded(pcm, sampleRate, channels)
}

private fun resampleToAlaw(decoded: Decoded, volume: Int): ByteArray {
    val channels = decoded.channels.coerceAtLeast(1)
    val pcm = decoded.pcm
    val gain = volume.coerceIn(0, 150) / 100f
    val mono = ShortArray(pcm.size / channels)
    var i = 0
    var o = 0
    while (i + channels <= pcm.size && o < mono.size) {
        var sum = 0
        for (c in 0 until channels) sum += pcm[i + c]
        mono[o] = (sum / channels).toShort()
        i += channels
        o += 1
    }
    val count = min(o, RATE * MAX_SECONDS).coerceAtLeast(1)
    val ratio = decoded.sampleRate.toDouble() / RATE
    val length = min(MAX_SECONDS * RATE, (count / ratio).toInt().coerceAtLeast(1))
    val alaw = ByteArray(length)
    for (n in 0 until length) {
        val source = min(count - 1, (n * ratio).roundToInt())
        val sample = (mono[source] * gain).roundToInt().coerceIn(-32768, 32767)
        alaw[n] = linearToAlaw(sample).toByte()
    }
    return alaw
}

private data class PcmFormat(val sampleRate: Int, val channels: Int)

private fun decoderOutput(input: MediaFormat): PcmFormat {
    val rate = if (input.containsKey(MediaFormat.KEY_SAMPLE_RATE)) input.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
    val channels = if (input.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) input.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 1
    return PcmFormat(rate.coerceAtLeast(8000), channels.coerceAtLeast(1))
}

private fun linearToAlaw(sample: Int): Int {
    var pcm = sample
    val mask: Int
    if (pcm >= 0) mask = 0x55 or 0x80 else {
        mask = 0x55
        pcm = -pcm - 1
    }
    var seg = 7
    var exp = 0x4000
    while (seg > 0 && pcm and exp == 0) {
        seg -= 1
        exp = exp shr 1
    }
    val mantissa = if (seg == 0) (pcm shr 4) and 0x0f else (pcm shr (seg + 3)) and 0x0f
    return ((seg shl 4) or mantissa) xor mask
}

fun playAlaw(host: String, password: String, alaw: ByteArray, english: Boolean, cancelled: () -> Boolean): Int {
    if (password.isEmpty()) error(if (english) "Cloud password required." else "Bulut şifresi gerekli.")
    if (alaw.isEmpty()) error(if (english) "The audio file is empty." else "Ses dosyası boş.")
    val parts = host.trim().split(":")
    val hostname = parts[0]
    val port = parts.getOrNull(1)?.toIntOrNull() ?: 8800
    var socket = open(hostname, port)
    var incoming = Incoming(socket)
    try {
        writeAll(socket, http(hostname, port, null))
        val first = readHeader(incoming)
        if (first.status != 401) error(if (english) "The camera did not ask for a password." else "Kamera şifre istemedi.")
        val challenge = digest(first.header("www-authenticate"))
        val hashed = hash(password, challenge.encrypt)
        val authorization = authorization(hashed, challenge)
        if (first.header("connection").equals("close", true)) {
            socket.close()
            socket = open(hostname, port)
            incoming = Incoming(socket)
        }
        writeAll(socket, http(hostname, port, authorization))
        val authed = readHeader(incoming)
        if (authed.status == 401) error(if (english) "Password rejected. Use the Tapo account password." else "Şifre kabul edilmedi. Tapo hesap şifresi gerekli.")
        if (authed.status != 200) error(if (english) "The camera did not open the stream (${authed.status})." else "Kamera akışı açılmadı (${authed.status}).")
        writeAll(socket, jsonPart("""{"params":{"talk":{"mode":"aec"},"method":"get"},"seq":3,"type":"request"}"""))
        val session = readSession(incoming, english)
        val muxer = PcmaMuxer()
        val pid = muxer.addTrack()
        sendTs(socket, session, muxer.header())
        val pad = (FRAME - alaw.size % FRAME) % FRAME
        val padded = ByteArray(alaw.size + pad + FRAME)
        alaw.copyInto(padded)
        for (i in alaw.size until padded.size) padded[i] = 0xD5.toByte()
        val frames = padded.size / FRAME
        val started = System.currentTimeMillis()
        for (frame in 0 until frames) {
            if (cancelled()) error(if (english) "Stopped." else "Durduruldu.")
            incoming.discard()
            val slice = padded.copyOfRange(frame * FRAME, (frame + 1) * FRAME)
            sendTs(socket, session, muxer.payload(pid, (frame + 1) * FRAME, slice))
            val due = started + ((frame + 1) * FRAME * 1000L) / RATE
            val wait = due - System.currentTimeMillis()
            if (wait > 0) Thread.sleep(wait)
        }
        return (alaw.size * 1000) / RATE
    } finally {
        runCatching { socket.close() }
    }
}

private class Incoming(socket: Socket) {
    private val queue = ArrayDeque<Byte>()
    private val lock = Object()
    @Volatile private var ended = false

    init {
        Thread {
            val input = socket.getInputStream()
            val buf = ByteArray(8192)
            try {
                while (true) {
                    val count = input.read(buf)
                    if (count < 0) break
                    synchronized(lock) {
                        for (index in 0 until count) queue.addLast(buf[index])
                        lock.notifyAll()
                    }
                }
            } catch (_: Exception) {
            } finally {
                synchronized(lock) {
                    ended = true
                    lock.notifyAll()
                }
            }
        }.apply {
            isDaemon = true
            name = "tapo-in"
            start()
        }
    }

    fun readByte(timeoutMs: Long): Int {
        val deadline = System.currentTimeMillis() + timeoutMs
        synchronized(lock) {
            while (queue.isEmpty() && !ended) {
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) return -1
                lock.wait(left)
            }
            if (queue.isEmpty()) return -1
            return queue.removeFirst().toInt() and 0xff
        }
    }

    fun discard() {
        synchronized(lock) { queue.clear() }
    }
}

private fun open(host: String, port: Int): Socket = Socket().apply {
    receiveBufferSize = 1024 * 1024
    sendBufferSize = 512 * 1024
    tcpNoDelay = true
    soTimeout = 0
    connect(InetSocketAddress(host, port), 8000)
}

private fun writeAll(socket: Socket, bytes: ByteArray) {
    val out = socket.getOutputStream()
    out.write(bytes)
    out.flush()
}

private class Header(val status: Int, val lines: Map<String, String>) {
    fun header(name: String) = lines[name.lowercase()] ?: ""
}

private fun readHeader(incoming: Incoming): Header {
    val raw = StringBuilder()
    while (!raw.endsWith("\r\n\r\n") && raw.length < 8192) {
        val byte = incoming.readByte(12000)
        if (byte < 0) break
        raw.append(byte.toChar())
    }
    val text = raw.toString()
    val status = Regex("HTTP/1\\.[01] (\\d+)").find(text)?.groupValues?.get(1)?.toIntOrNull() ?: 0
    val lines = mutableMapOf<String, String>()
    text.split("\r\n").drop(1).forEach { line ->
        val colon = line.indexOf(':')
        if (colon > 0) lines[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
    }
    val length = lines["content-length"]?.toIntOrNull() ?: 0
    repeat(length) { incoming.readByte(12000) }
    return Header(status, lines)
}

private fun readSession(incoming: Incoming, english: Boolean): String {
    val window = StringBuilder()
    val deadline = System.currentTimeMillis() + 12000
    while (System.currentTimeMillis() < deadline && window.length < 16384) {
        val byte = incoming.readByte(12000)
        if (byte < 0) break
        window.append(byte.toChar())
        val text = window.toString()
        val id = Regex(""""session_?[Ii]d"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1)
        if (!id.isNullOrEmpty()) return id
        val code = Regex(""""error_code"\s*:\s*(-?\d+)""").find(text)?.groupValues?.get(1)?.toIntOrNull()
        if (code != null && code != 0 && text.contains('}')) {
            error(if (english) "The camera rejected the talk request ($code)." else "Kamera konuşmayı reddetti ($code).")
        }
    }
    error(if (english) "The camera did not start a talk session." else "Kameradan konuşma oturumu gelmedi.")
}

private data class Challenge(val realm: String, val nonce: String, val qop: String, val opaque: String, val encrypt: String)

private fun digest(header: String): Challenge {
    fun field(name: String) = Regex("""$name=(?:"([^"]*)"|([^,\s]+))""", RegexOption.IGNORE_CASE).find(header)?.let { it.groupValues[1].ifEmpty { it.groupValues[2] } } ?: ""
    return Challenge(field("realm"), field("nonce"), field("qop").substringBefore(',').trim(), field("opaque"), if (field("encrypt_type") == "3") "SHA-256" else "MD5")
}

private fun hash(password: String, algorithm: String): String =
    MessageDigest.getInstance(algorithm).digest(password.toByteArray()).joinToString("") { "%02X".format(it) }

private fun md5(value: String) = MessageDigest.getInstance("MD5").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

private fun authorization(password: String, challenge: Challenge): String {
    val cnonce = java.util.UUID.randomUUID().toString().replace("-", "")
    val ha1 = md5("admin:${challenge.realm}:$password")
    val ha2 = md5("POST:/stream")
    val response = if (challenge.qop.isNotEmpty()) md5("$ha1:${challenge.nonce}:00000001:$cnonce:${challenge.qop}:$ha2") else md5("$ha1:${challenge.nonce}:$ha2")
    var header = """Digest username="admin", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="/stream""""
    header += if (challenge.qop.isNotEmpty()) """, qop=${challenge.qop}, nc=00000001, cnonce="$cnonce", response="$response"""" else """, response="$response""""
    if (challenge.opaque.isNotEmpty()) header += """, opaque="${challenge.opaque}", algorithm=MD5"""
    return header
}

private fun http(host: String, port: Int, authorization: String?): ByteArray {
    val lines = mutableListOf(
        "POST /stream HTTP/1.1",
        "Host: $host:$port",
        "User-Agent: tapo-ses",
        "Content-Type: multipart/mixed; boundary=--client-stream-boundary--",
        "Content-Length: 0",
        "Connection: keep-alive",
    )
    if (authorization != null) lines += "Authorization: $authorization"
    return (lines.joinToString("\r\n") + "\r\n\r\n").toByteArray()
}

private fun jsonPart(json: String): ByteArray {
    val head = "----client-stream-boundary--\r\nContent-Type: application/json\r\nContent-Length: ${json.toByteArray().size}\r\n\r\n"
    return (head + json + "\r\n").toByteArray()
}

private fun sendTs(socket: Socket, session: String, body: ByteArray) {
    val head = "----client-stream-boundary--\r\nContent-Type: audio/mp2t\r\nX-If-Encrypt: 0\r\nX-Session-Id: $session\r\nContent-Length: ${body.size}\r\n\r\n"
    val out = socket.getOutputStream()
    out.write(head.toByteArray())
    out.write(body)
    out.flush()
}

private class BitWriter {
    val buf = ArrayList<Int>()
    var bits = 0
    private var byteIndex = -1
    fun writeByte(b: Int) {
        if (bits != 0) writeBits(b, 8) else buf.add(b and 0xff)
    }
    fun writeBit(b: Int) {
        if (bits == 0) {
            buf.add(0)
            byteIndex = buf.lastIndex
            bits = 7
        } else bits -= 1
        buf[byteIndex] = (buf[byteIndex] or ((b and 1) shl bits)) and 0xff
    }
    fun writeBits(v: Int, n: Int) { for (i in n - 1 downTo 0) writeBit((v shr i) and 1) }
    fun writeUint16(v: Int) {
        if (bits != 0) writeBits(v, 16) else {
            buf.add((v shr 8) and 0xff)
            buf.add(v and 0xff)
        }
    }
    fun writeBytes(bytes: ByteArray) { bytes.forEach { writeByte(it.toInt() and 0xff) } }
    fun bytes() = ByteArray(buf.size) { buf[it].toByte() }
    fun len() = buf.size
}

private class Pes {
    val streamType = 0x90
    val streamId = 0xc0
    var pts = 0
    var timestamp = 0
    var payload = ByteArray(0)
    var size = 0
    var sequence = 0
}

private class PcmaMuxer {
    private val tracks = linkedMapOf<Int, Pes>()
    fun addTrack(): Int {
        val pid = 0x100 + tracks.size
        tracks[pid] = Pes()
        return pid
    }
    fun header(): ByteArray {
        val wr = BitWriter()
        writePat(wr)
        writePmt(wr)
        return wr.bytes()
    }
    fun payload(pid: Int, timestamp: Int, payload: ByteArray): ByteArray {
        val pes = tracks[pid]!!
        if (pes.timestamp != 0) pes.pts = (pes.pts + (timestamp - pes.timestamp)).toUInt().toInt()
        pes.timestamp = timestamp
        val size = 3 + 5 + payload.size
        val head = ByteArray(14)
        head[2] = 1
        head[3] = pes.streamId.toByte()
        if (size <= 0xffff) {
            head[4] = (size shr 8).toByte()
            head[5] = size.toByte()
        }
        head[6] = 0x80.toByte()
        head[7] = 0x80.toByte()
        head[8] = 5
        writeTime(head, 9, pes.pts)
        pes.payload = head + payload
        pes.size = 1
        val wr = BitWriter()
        while (pes.payload.isNotEmpty()) {
            writePes(wr, pid, pes)
            pes.sequence += 1
            pes.size = 0
        }
        return wr.bytes()
    }
    private fun writePat(wr: BitWriter) {
        writeHeader(wr, 0)
        val crcStart = wr.len() + 1
        writePsi(wr, 0, 4)
        wr.writeUint16(1)
        wr.writeBits(0b111, 3)
        wr.writeBits(0x1000, 13)
        writeCrc(wr, crcStart)
        writeTail(wr)
    }
    private fun writePmt(wr: BitWriter) {
        writeHeader(wr, 0x1000)
        val crcStart = wr.len() + 1
        writePsi(wr, 2, 4 + tracks.size * 5)
        wr.writeBits(0b111, 3)
        wr.writeBits(0x1fff, 13)
        wr.writeBits(0b1111, 4)
        wr.writeBits(0, 2)
        wr.writeBits(0, 10)
        tracks.forEach { (pid, pes) ->
            wr.writeByte(pes.streamType)
            wr.writeBits(0b111, 3)
            wr.writeBits(pid, 13)
            wr.writeBits(0b1111, 4)
            wr.writeBits(0, 2)
            wr.writeBits(0, 10)
        }
        writeCrc(wr, crcStart)
        writeTail(wr)
    }
    private fun writePes(wr: BitWriter, pid: Int, pes: Pes) {
        wr.writeByte(0x47)
        var field = pid
        if (pes.size != 0) field = field or 0b0100_0000_0000_0000
        wr.writeUint16(field)
        val counter = pes.sequence and 0xf
        if (pes.payload.size < 188 - 4) {
            wr.writeByte(0b0010_0000 or 0b0001_0000 or counter)
            val ad = 188 - 4 - 1 - pes.payload.size
            wr.writeByte(ad)
            if (ad > 0) wr.writeBytes(ByteArray(ad))
            wr.writeBytes(pes.payload)
            pes.payload = ByteArray(0)
        } else {
            wr.writeByte(0b0001_0000 or counter)
            wr.writeBytes(pes.payload.copyOfRange(0, 188 - 4))
            pes.payload = pes.payload.copyOfRange(188 - 4, pes.payload.size)
        }
    }
    private fun writeHeader(wr: BitWriter, pid: Int) {
        wr.writeByte(0x47)
        wr.writeBit(0); wr.writeBit(1); wr.writeBit(0)
        wr.writeBits(pid, 13)
        wr.writeBits(0, 2)
        wr.writeBit(0); wr.writeBit(1)
        wr.writeBits(0, 4)
    }
    private fun writePsi(wr: BitWriter, tableId: Int, size: Int) {
        wr.writeByte(0)
        wr.writeByte(tableId)
        wr.writeBit(1); wr.writeBit(0)
        wr.writeBits(0b11, 2)
        wr.writeBits(0, 2)
        wr.writeBits(5 + size + 4, 10)
        wr.writeUint16(1)
        wr.writeBits(0b11, 2)
        wr.writeBits(0, 5)
        wr.writeBit(1)
        wr.writeByte(0)
        wr.writeByte(0)
    }
    private fun writeTail(wr: BitWriter) {
        val remainder = wr.len() % 188
        if (remainder == 0) return
        wr.writeBytes(ByteArray(188 - remainder))
    }
    private fun writeCrc(wr: BitWriter, start: Int) {
        val crc = mpegCrc(wr.bytes().copyOfRange(start, wr.len()))
        wr.writeByte((crc ushr 24).toInt())
        wr.writeByte(((crc ushr 16) and 0xff).toInt())
        wr.writeByte(((crc ushr 8) and 0xff).toInt())
        wr.writeByte((crc and 0xff).toInt())
    }
}

private fun mpegCrc(data: ByteArray): Long {
    var crc = 0xffffffffL
    for (byte in data) {
        crc = crc xor ((byte.toLong() and 0xff) shl 24)
        repeat(8) {
            crc = if (crc and 0x80000000L != 0L) ((crc shl 1) xor 0x04c11db7L) and 0xffffffffL else (crc shl 1) and 0xffffffffL
        }
    }
    return crc
}

private fun writeTime(target: ByteArray, offset: Int, timestamp: Int) {
    val t = timestamp.toUInt()
    target[offset] = ((0x20 or (t shr (32 - 3)).toInt()) or 1).toByte()
    target[offset + 1] = (t shr (24 - 2)).toByte()
    target[offset + 2] = (((t shr (16 - 2)).toInt()) or 1).toByte()
    target[offset + 3] = (t shr (8 - 1)).toByte()
    target[offset + 4] = (((t.toInt() shl 1) or 1) and 0xff).toByte()
}
