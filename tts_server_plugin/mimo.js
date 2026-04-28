let API_URL = 'https://api.xiaomimimo.com/v1/chat/completions'
let MODEL_V2 = 'mimo-v2-tts'
let MODEL_V25 = 'mimo-v2.5-tts'
let DEFAULT_MODEL = MODEL_V25
let DEFAULT_FORMAT = 'wav'
let STREAM_FORMAT = 'pcm16'
let SAMPLE_RATE = 24000
let VOICE_SEPARATOR = '|'

const MIMO_VOICES = [
    { id: voiceId(MODEL_V25, 'mimo_default'), model: MODEL_V25, voice: 'mimo_default', name: 'MiMo Default (V2.5)', locale: '*' },
    { id: voiceId(MODEL_V25, '\u51b0\u7cd6'), model: MODEL_V25, voice: '\u51b0\u7cd6', name: '\u51b0\u7cd6 (V2.5)', locale: 'zh-CN' },
    { id: voiceId(MODEL_V25, '\u8309\u8389'), model: MODEL_V25, voice: '\u8309\u8389', name: '\u8309\u8389 (V2.5)', locale: 'zh-CN' },
    { id: voiceId(MODEL_V25, '\u82cf\u6253'), model: MODEL_V25, voice: '\u82cf\u6253', name: '\u82cf\u6253 (V2.5)', locale: 'zh-CN' },
    { id: voiceId(MODEL_V25, '\u767d\u6866'), model: MODEL_V25, voice: '\u767d\u6866', name: '\u767d\u6866 (V2.5)', locale: 'zh-CN' },
    { id: voiceId(MODEL_V25, 'Mia'), model: MODEL_V25, voice: 'Mia', name: 'Mia (V2.5)', locale: 'en-US' },
    { id: voiceId(MODEL_V25, 'Chloe'), model: MODEL_V25, voice: 'Chloe', name: 'Chloe (V2.5)', locale: 'en-US' },
    { id: voiceId(MODEL_V25, 'Milo'), model: MODEL_V25, voice: 'Milo', name: 'Milo (V2.5)', locale: 'en-US' },
    { id: voiceId(MODEL_V25, 'Dean'), model: MODEL_V25, voice: 'Dean', name: 'Dean (V2.5)', locale: 'en-US' },
    { id: voiceId(MODEL_V2, 'mimo_default'), model: MODEL_V2, voice: 'mimo_default', name: 'MiMo Default (V2)', locale: '*' },
    { id: voiceId(MODEL_V2, 'default_zh'), model: MODEL_V2, voice: 'default_zh', name: 'MiMo Chinese Female (V2)', locale: 'zh-CN' },
    { id: voiceId(MODEL_V2, 'default_en'), model: MODEL_V2, voice: 'default_en', name: 'MiMo English Female (V2)', locale: 'en-US' }
]

function voiceId(model, voice) {
    return model + VOICE_SEPARATOR + voice
}

function findVoiceById(id) {
    for (let i = 0; i < MIMO_VOICES.length; i++) {
        if (MIMO_VOICES[i].id === id) {
            return MIMO_VOICES[i]
        }
    }

    return null
}

function findVoiceByPlainValue(voice) {
    let first = null

    for (let i = 0; i < MIMO_VOICES.length; i++) {
        if (MIMO_VOICES[i].voice === voice) {
            first = first || MIMO_VOICES[i]
            if (MIMO_VOICES[i].model === MODEL_V25) {
                return MIMO_VOICES[i]
            }
        }
    }

    return first
}

function resolveVoiceConfig(voice) {
    let value = String(voice || '').trim()

    if (!value) {
        value = voiceId(DEFAULT_MODEL, 'mimo_default')
    }

    let known = findVoiceById(value)
    if (known) {
        return known
    }

    if (value.indexOf(VOICE_SEPARATOR) > 0) {
        let parts = value.split(VOICE_SEPARATOR)
        let model = parts.shift()
        let rawVoice = parts.join(VOICE_SEPARATOR)

        if (model === MODEL_V2 || model === MODEL_V25) {
            return {
                id: value,
                model: model,
                voice: rawVoice,
                name: rawVoice,
                locale: '*'
            }
        }
    }

    if (value.indexOf('v2:') === 0) {
        return {
            id: value,
            model: MODEL_V2,
            voice: value.substring(3),
            name: value.substring(3),
            locale: '*'
        }
    }

    if (value.indexOf('v25:') === 0 || value.indexOf('v2.5:') === 0) {
        let raw = value.substring(value.indexOf(':') + 1)
        return {
            id: value,
            model: MODEL_V25,
            voice: raw,
            name: raw,
            locale: '*'
        }
    }

    if (value === 'default_zh' || value === 'default_en') {
        return {
            id: voiceId(MODEL_V2, value),
            model: MODEL_V2,
            voice: value,
            name: value,
            locale: '*'
        }
    }

    let plain = findVoiceByPlainValue(value)
    if (plain) {
        return plain
    }

    return {
        id: value,
        model: DEFAULT_MODEL,
        voice: value,
        name: value,
        locale: '*'
    }
}

function userVar(name, defaultValue) {
    let value = ttsrv.userVars[name]
    if (value == null) {
        return defaultValue
    }

    value = String(value).trim()
    return value ? value : defaultValue
}

function check() {
    userVar('apiKey', '') || function () { throw 'MiMo API Key not set' }()
}

function numberOrDefault(value, defaultValue) {
    let parsed = Number(value)
    return isNaN(parsed) ? defaultValue : parsed
}

function buildProsodyInstruction(rate, pitch) {
    let parts = []
    let rateValue = numberOrDefault(rate, 50)
    let pitchValue = numberOrDefault(pitch, 50)

    if (rateValue >= 70) {
        parts.push('Speak noticeably faster than normal.')
    } else if (rateValue >= 56) {
        parts.push('Speak slightly faster than normal.')
    } else if (rateValue <= 30) {
        parts.push('Speak noticeably slower than normal.')
    } else if (rateValue <= 44) {
        parts.push('Speak slightly slower than normal.')
    }

    if (pitchValue >= 70) {
        parts.push('Use a noticeably higher pitch.')
    } else if (pitchValue >= 56) {
        parts.push('Use a slightly higher pitch.')
    } else if (pitchValue <= 30) {
        parts.push('Use a noticeably lower pitch.')
    } else if (pitchValue <= 44) {
        parts.push('Use a slightly lower pitch.')
    }

    return parts.join(' ')
}

function buildPitchInstruction(pitch) {
    let pitchValue = numberOrDefault(pitch, 50)

    if (pitchValue >= 70) {
        return 'Use a noticeably higher pitch.'
    } else if (pitchValue >= 56) {
        return 'Use a slightly higher pitch.'
    } else if (pitchValue <= 30) {
        return 'Use a noticeably lower pitch.'
    } else if (pitchValue <= 44) {
        return 'Use a slightly lower pitch.'
    }

    return ''
}

function buildV2AssistantText(text, style, rate) {
    let assistantText = String(text || '')

    if (/^\s*<style>/i.test(assistantText)) {
        return assistantText
    }

    let tags = []
    let styleText = String(style || '').trim()
    let rateValue = numberOrDefault(rate, 50)

    if (styleText) {
        if (/^\s*<style>[\s\S]*<\/style>\s*$/i.test(styleText)) {
            return styleText + assistantText
        }

        tags.push(styleText.replace(/<\/?style>/ig, '').trim())
    }

    if (rateValue >= 56) {
        tags.push('Speed up')
    } else if (rateValue <= 44) {
        tags.push('Slow down')
    }

    if (!tags.length) {
        return assistantText
    }

    return '<style>' + tags.join(' ') + '</style>' + assistantText
}

function buildMessages(text, style, rate, pitch, voiceConfig) {
    let messages = []
    let instructions = []
    let model = voiceConfig && voiceConfig.model ? voiceConfig.model : DEFAULT_MODEL
    let assistantText = text

    if (model === MODEL_V2) {
        assistantText = buildV2AssistantText(text, style, rate)
        let pitchInstruction = buildPitchInstruction(pitch)

        if (pitchInstruction) {
            instructions.push(pitchInstruction)
        }
    } else {
        let prosody = buildProsodyInstruction(rate, pitch)

        if (style) {
            instructions.push(style)
        }

        if (prosody) {
            instructions.push(prosody)
        }
    }

    if (instructions.length) {
        messages.push({
            role: 'user',
            content: instructions.join(' ')
        })
    }

    messages.push({
        role: 'assistant',
        content: assistantText
    })

    return messages
}

function buildPayload(text, voice, rate, pitch, style, format, stream) {
    let voiceConfig = resolveVoiceConfig(voice)
    let payload = {
        model: voiceConfig.model,
        messages: buildMessages(text, style, rate, pitch, voiceConfig),
        audio: {
            format: format || DEFAULT_FORMAT,
            voice: voiceConfig.voice
        }
    }

    if (stream) {
        payload.stream = true
    }

    return payload
}

function truncate(value, maxLength) {
    value = value == null ? '' : String(value)
    if (value.length <= maxLength) {
        return value
    }

    return value.substring(0, maxLength) + '...'
}

function extractAudioData(payload) {
    let choices = payload && payload.choices
    if (choices && choices.length) {
        let first = choices[0]
        let messageAudio = first.message && first.message.audio
        let deltaAudio = first.delta && first.delta.audio

        if (messageAudio && messageAudio.data) {
            return messageAudio.data
        }

        if (deltaAudio && deltaAudio.data) {
            return deltaAudio.data
        }
    }

    if (payload && payload.audio && payload.audio.data) {
        return payload.audio.data
    }

    return null
}

function extractStreamAudioData(data) {
    if (!data || data === '[DONE]') {
        return null
    }

    let payload = JSON.parse(data)
    let errorMessage = extractErrorMessage(payload)

    if (errorMessage) {
        throw errorMessage
    }

    return extractAudioData(payload)
}

function extractErrorMessage(payload) {
    if (payload && payload.error) {
        if (payload.error.message) {
            return payload.error.message
        }

        return JSON.stringify(payload.error)
    }

    return ''
}

function cleanBase64Data(data) {
    data = String(data || '')
    if (data.indexOf('data:') === 0) {
        let comma = data.indexOf(',')
        if (comma >= 0) {
            return data.substring(comma + 1)
        }
    }

    return data
}

function decodeBase64(data) {
    data = cleanBase64Data(data)

    try {
        return java.util.Base64.getDecoder().decode(data)
    } catch (e) {
        try {
            return android.util.Base64.decode(data, android.util.Base64.DEFAULT)
        } catch (ignored) {
            throw 'Base64 decode failed: ' + e
        }
    }
}

function readBody(resp) {
    let body = resp.body()
    return body ? body.string() : ''
}

function buildHeaders(stream) {
    return {
        'api-key': userVar('apiKey', ''),
        'Content-Type': 'application/json',
        'Accept': stream ? 'text/event-stream' : 'application/json'
    }
}

function synthesize(text, voice, rate, pitch) {
    check()

    let payload = buildPayload(text, voice, rate, pitch, userVar('style', ''), DEFAULT_FORMAT, false)
    let headers = buildHeaders(false)
    let resp = ttsrv.httpPost(API_URL, JSON.stringify(payload), headers)
    let respText = readBody(resp)
    let respJson = null

    try {
        respJson = JSON.parse(respText)
    } catch (e) {
    }

    if (!resp.isSuccessful()) {
        let detail = extractErrorMessage(respJson) || respText
        throw 'MiMo TTS failed: HTTP ' + resp.code() + ' ' + truncate(detail, 500)
    }

    let audioData = extractAudioData(respJson)
    if (!audioData) {
        throw 'MiMo TTS response did not contain choices[0].message.audio.data: ' + truncate(respText, 500)
    }

    return decodeBase64(audioData)
}

function writeStreamAudioData(data, callback) {
    let audioData = extractStreamAudioData(data)

    if (!audioData) {
        return false
    }

    callback.write(decodeBase64(audioData))
    return true
}

function parseStreamResponse(inputStream, callback) {
    let reader = new java.io.BufferedReader(new java.io.InputStreamReader(inputStream, 'UTF-8'))
    let dataLines = []
    let rawLines = []
    let wrote = false
    let line

    function flushDataLines() {
        if (!dataLines.length) {
            return false
        }

        let data = dataLines.join('\n').trim()
        dataLines = []

        if (!data || data === '[DONE]') {
            return false
        }

        if (writeStreamAudioData(data, callback)) {
            wrote = true
        }

        return true
    }

    try {
        while ((line = reader.readLine()) != null) {
            line = String(line)

            if (line.indexOf('data:') === 0) {
                dataLines.push(line.substring(5).trim())
            } else if (line.trim() === '') {
                flushDataLines()
            } else if (line.charAt(0) === ':') {
            } else {
                rawLines.push(line)
            }
        }

        flushDataLines()
    } finally {
        try {
            reader.close()
        } catch (e) {
        }
    }

    if (!wrote && rawLines.length) {
        let rawText = rawLines.join('\n')
        let audioData = extractAudioData(JSON.parse(rawText))

        if (audioData) {
            callback.write(decodeBase64(audioData))
            wrote = true
        }
    }

    if (!wrote) {
        throw 'MiMo TTS stream response did not contain audio data'
    }
}

function synthesizeStream(text, voice, rate, pitch, callback) {
    check()

    let payload = buildPayload(text, voice, rate, pitch, userVar('style', ''), STREAM_FORMAT, true)
    let headers = buildHeaders(true)
    let resp = ttsrv.httpPost(API_URL, JSON.stringify(payload), headers)

    if (!resp.isSuccessful()) {
        let respText = readBody(resp)
        let respJson = null

        try {
            respJson = JSON.parse(respText)
        } catch (e) {
        }

        let detail = extractErrorMessage(respJson) || respText
        throw 'MiMo TTS stream failed: HTTP ' + resp.code() + ' ' + truncate(detail, 500)
    }

    parseStreamResponse(resp.body().byteStream(), callback)
}

let PluginJS = {
    name: 'MiMo TTS',
    id: 'xiaomimimo.com',
    author: 'TTS Server',
    description: 'Xiaomi MiMo-V2 and MiMo-V2.5 TTS built-in voices',
    version: 2,
    iconUrl: 'https://platform.xiaomimimo.com/static/favicon.874c9507.png',
    vars: {
        apiKey: {
            label: 'API Key',
            hint: 'MiMo API Key'
        },
        style: {
            label: 'Style',
            hint: 'Optional natural language style instruction'
        }
    },

    getAudio: function (text, locale, voice, rate, volume, pitch) {
        let bytes = synthesize(text, voice, rate, pitch)
        return new java.io.ByteArrayInputStream(bytes)
    },

    getAudioV2: function (request, callback) {
        try {
            synthesizeStream(request.text, request.voice, request.rate, request.pitch, callback)
            callback.close()
        } catch (e) {
            callback.error(String(e))
        }
    }
}

let EditorJS = {
    getAudioSampleRate: function () {
        return SAMPLE_RATE
    },

    getLocales: function () {
        return ['zh-CN', 'en-US']
    },

    getVoices: function (locale) {
        let mm = {}
        MIMO_VOICES.forEach(v => {
            if (!locale || v.locale === locale || v.locale === '*') {
                mm[v.id] = {
                    name: v.name
                }
            }
        })

        return mm
    },

    onLoadData: function () {
    },

    onLoadUI: function () {
    },

    onVoiceChanged: function () {
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildMessages: buildMessages,
        buildPayload: buildPayload,
        extractAudioData: extractAudioData,
        extractStreamAudioData: extractStreamAudioData,
        resolveVoiceConfig: resolveVoiceConfig,
        cleanBase64Data: cleanBase64Data
    }
}
