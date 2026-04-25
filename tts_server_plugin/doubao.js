let cookie = ttsrv.userVars['cookie']

let req = {}
var callback = null
let ws = null

const DOUBAO_WEB_CONFIG = {
    mode: '0',
    language: 'zh',
    browser_language: 'zh-CN',
    device_platform: 'web',
    aid: '497858',
    real_aid: '497858',
    pkg_type: 'release_version',
    is_new_user: '0',
    region: 'CN',
    sys_region: 'CN',
    'use-olympus-account': '1',
    samantha_web: '1',
    version: '3.16.1',
    version_code: '31601',
    pc_version: '3.16.1'
}

const DEFAULT_VOICES = [
    {
        name: '温柔桃子（升级版）',
        style_id: 'zh_female_wenroutaozi_uranus_bigtts',
        language_code: 'zh',
        icon: {
            url: 'https://p26-flow-imagex-sign.byteimg.com/obj/ocean-cloud-tos/FileBizType.BIZ_BOT_ICON/1166209_1705411537442891198.png'
        },
        tag_list: [
            { tag_value: '女' },
            { tag_value: '青年' },
            { tag_value: '温柔' }
        ]
    },
    {
        name: '磁性俊宇（升级版）',
        style_id: 'zh_male_nuanxinshizhe_mars_bigtts',
        language_code: 'zh',
        icon: {
            url: 'https://p26-flow-imagex-sign.byteimg.com/obj/ocean-cloud-tos/FileBizType.BIZ_BOT_ICON/7128072_1721222049957338808.png'
        },
        tag_list: [
            { tag_value: '男' },
            { tag_value: '青年' },
            { tag_value: '帅气' }
        ]
    },
    {
        name: '阳光甜妹（升级版）',
        style_id: 'zh_female_xiaohe_conversation_wvae_bigtts',
        language_code: 'zh',
        icon: {
            url: 'https://p3-flow-imagex-sign.byteimg.com/obj/ocean-cloud-tos/FileBizType.BIZ_BOT_ICON/8188900_1716780512224291231.png'
        },
        tag_list: [
            { tag_value: '女' },
            { tag_value: '青年' },
            { tag_value: '台湾口音' },
            { tag_value: '温柔' }
        ]
    },
    {
        name: '温柔桃子（经典版）',
        style_id: 'zh_female_wenroutaozi_v2_mars_bigtts',
        language_code: 'zh',
        icon: {
            url: 'https://p3-flow-imagex-sign.byteimg.com/obj/ocean-cloud-tos/FileBizType.BIZ_BOT_ICON/6365612_1763519239309252298.png'
        },
        tag_list: [
            { tag_value: '女' },
            { tag_value: '青年' },
            { tag_value: '温柔' }
        ]
    }
]

function check() {
    cookie || function () { throw 'Cookie not set' }()
}

function id() {
    const num1 = Math.floor(1e8 + 9e8 * Math.random())
    const num2 = Math.floor(1e8 + 9e8 * Math.random())
    return String(num1) + String(num2)
}

function buildCommonQueryString(deviceId) {
    let params = Object.assign({}, DOUBAO_WEB_CONFIG, {
        device_id: deviceId,
        tea_uuid: deviceId,
        web_id: deviceId
    })

    return Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key])}`)
        .join('&')
}

function extractVoiceList(payload) {
    let data = payload && payload.data ? payload.data : null
    let candidates = [
        data && data.ugc_voice_list,
        data && data.voice_list,
        data && data.voice_data_list,
        payload && payload.ugc_voice_list,
        payload && payload.voice_list,
        payload && payload.voice_data_list
    ]

    for (let i = 0; i < candidates.length; i++) {
        if (Array.isArray(candidates[i])) {
            return candidates[i]
        }
    }

    return []
}

function describeVoicePayload(payload) {
    let data = payload && payload.data ? payload.data : {}
    return Object.keys(data).join(', ')
}

var count = 0
var currentId = id()

function commonParams() {
    count++
    if (count > 5) {
        count = 0
        currentId = id()
    }

    return '&' + buildCommonQueryString(currentId)
}

let PluginJS = {
    name: 'Doubao Fix',
    id: 'doubao.com',
    author: 'TTS Server',
    version: 5,
    iconUrl: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/web/logo-icon.png',
    vars: {
        cookie: {
            label: 'Cookie',
            hint: 'Complete request header Cookie',
            loginUrl: 'https://www.doubao.com/chat',
            binding: 'cookies',
            ua: 'mobile'
        }
    },

    onStop: function () {
        if (ws != null) {
            ws.cancel()
        }
    },

    getAudioV2: function (request, callback2) {
        check()

        callback = callback2
        req = {
            text: request.text,
            speaker: request.voice,
            rate: (request.rate * 2) - 100,
            pitch: request.pitch - 50
        }

        getAudio()
    }
}

function getAudio() {
    if (ws == null) {
        logger.i('init Websocket')
        let url = `wss://ws-samantha.doubao.com/samantha/audio/tts?format=aac&speaker=${req.speaker}&speech_rate=${req.rate}&pitch=${req.pitch}` + commonParams()
        let headers = {
            Cookie: cookie,
            Origin: 'chrome-extension://capohkkfagimodmlpnahjoijgoocdjhd',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0'
        }
        ws = new Websocket(url, headers)

        ws.on('close', function (code, reason) {
            ws = null
            if (code == 1000) {
                callback.close()
            } else {
                callback.error(reason)
            }
        })

        ws.on('error', function (err, resp) {
            ws = null
            if (resp && typeof resp.text === 'function') {
                console.error(resp.text())
            }
            callback.error(err)
        })

        ws.on('binary', function (buffer) {
            callback.write(buffer)
        })

        ws.on('text', function (msg) {
            console.log(msg)
        })

        ws.on('open', function () {
            logger.d('open')
            getAudio()
        })

        return
    }

    if (ws.readyState === Websocket.OPEN) {
        sendMessage()
    } else {
        ws = null
        return getAudio()
    }

    function sendMessage() {
        logger.i('sendMessage....')
        send(`{"event":"text","podcast_extra":{"role":""},"text":"${req.text}"}`)
        send('{"event":"finish"}')
    }

    function send(msg) {
        let ok = ws.send(msg)
        if (!ok) {
            callback.error('send message failed: ' + msg)
        }
    }
}

let locales = []
let voices = []

function addVoice(v) {
    voices.push(v)
    if (!locales.includes(v.language_code)) {
        locales.push(v.language_code)
    }
}

function useFallbackVoices(reason) {
    logger.i('using fallback Doubao voices: ' + reason)
    if (!voices.length) {
        DEFAULT_VOICES.forEach(addVoice)
    }
}

let EditorJS = {
    getAudioSampleRate: function () {
        return 24000
    },

    getLocales: function () {
        return locales
    },

    getVoices: function () {
        let mm = new Map()
        voices.forEach(v => {
            let tags = Array.isArray(v.tag_list) ? v.tag_list.map(t => t.tag_value).join('|') : ''
            let icon = v.icon && v.icon.url ? v.icon.url : ''
            mm[v.style_id] = {
                name: tags ? `${v.name} ${tags}` : v.name,
                iconUrl: icon
            }
        })

        return mm
    },

    onLoadData: function () {
        check()
        voices = []
        locales = []
        useFallbackVoices('fixed built-in voices')
    },

    onLoadUI: function () {
    },

    onVoiceChanged: function () {
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildCommonQueryString: buildCommonQueryString,
        extractVoiceList: extractVoiceList
    }
}
