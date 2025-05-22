class BS {
	static async start() {
		// BS_KEYS.html
		let params = new URLSearchParams(window.location.search)
		DB.set('tokens', [
			{
				"type": "browsersourced",
				"name": "user",
				"id": "0",
				"token": ""
			},
			{
				"type": "twitch",
				"name": "broadcaster",
				"token": params.get('a'),
				"client": "4myljx99qvgdusksplltrj85hazw67"
			},
			{
				"type": "twitch",
				"name": "bot",
				"token": params.get('b'),
				"client": "4myljx99qvgdusksplltrj85hazw67"
			},
			{
				"type": "aws",
				"name": "user",
				"id": params.get('c'),
				"secret": params.get('d')
			}
		])

		// Load tokens
		let stor = DB.get('tokens') ?? []
		let configPath
		let twitch = []
		let discord = []
		let aws = []
		stor.forEach((item) => {
			switch (item.type) {
				case 'browsersourced':
					configPath = 'https://banieldadcliffe.github.io/BrowserSourced/config.json'
					break
				case 'twitch':
					twitch.push(item)
					break
				case 'discord':
					discord.push(item)
					break
				case 'aws':
					aws.push(item)
					break
			}
		})
		if (!configPath) {
			return
		}

		// Load config
		let response = await fetch(configPath)
		let config = await response.json()
		DB._install(config.storage)
		Actions._install(config.automations)

		// Set accounts
		AWS._set_accounts(aws)
		await Twitch._set_accounts(twitch)
		// Discord.connect(discord)
	}
}

class Events {
	static _events = new EventTarget()
	static _eventId = -1
	static _createId() {
		Events._eventId ++
		return String(Events._eventId)
	}
	static _emit(name, data) {
		Events._events.dispatchEvent(new CustomEvent(name, {
			detail: data
		}))
	}
	static register(name, func) {
		let id = Events._createId()
		Actions.set(id, func)
		Events._events.addEventListener(name, (e) => {
			Actions._call(id, e.detail)
		})
	}
}

class DB {
	static set(key, value) {
		localStorage.setItem(key.toLowerCase(), JSON.stringify({ data: value }))
	}
	static get(key) {
		let d = localStorage.getItem(key.toLowerCase())
		if (d) {
			return JSON.parse(d).data
		}
	}
	static remove(key) {
		localStorage.removeItem(key.toLowerCase())
	}
	static has(key) {
		return localStorage.getItem(key.toLowerCase())
	}
	static _install(list) {
		list.forEach((item) => {
			item.data.forEach((command) => {
				command.name.forEach((name) => {
					DB.set(`${item.key}.${name}`, command.response)
				})
			})
		})
	}
}

class Commands {
	static _keywords_and_commands(data) {
		let key = `${data.commandType}.${data.commandName}`
		if (data.commandName && DB.has(key)) {
			Commands._commands(DB.get(key), data)
		} else {
			Commands._keywords(data)
		}
	}
	static _keywords(data) {
		if (data.message.length === 0) {
			return
		}
		let keywords = DB.get('keywords') ?? []
		keywords.forEach((k) => {
			if (data.message.toLowerCase().includes(k.name.toLowerCase())) {
				Commands._commands(k.response, data)
			}
		})
		let keywordsCase = DB.get('keywords_case_sensitive') ?? []
		keywordsCase.forEach((k) => {
			if (data.message.includes(k.name)) {
				Commands._commands(k.response, data)
			}
		})
	}
	static async _commands(commands, data) {
		for await (const command of commands) {
			if (command.userlevel === 'moderator' && data.isModerator === false) {
				continue
			}
			let text = await Commands._parse(command.text, data)
			let reply = command.isReply ? data.msgId : null
			let account = command.account ?? 'app'
			Twitch.send(text, reply, account)
		}
	}
	static async _parse(input, data) {
		let chs = Array.from(input)
		let starts = []
		let i = 0
		let finalString = ''
	
		for await (const ch of chs) {
			if (
				ch === '$' &&
				chs.at(i + 1) === '(' &&
				chs.at(i - 1) !== '\\'
			) {
				// Argument start found
				starts.push(i + 2)
			} else if (
				ch === ')' &&
				chs.at(i - 1) !== '\\' &&
				starts.length > 1
			) {
				// Recursive argument found, so let's do it later
				starts.pop()
			} else if (
				ch === ')' &&
				chs.at(i - 1) !== '\\' &&
				starts.length === 1
			) {
				// Argument end found, so let's split
				let argString = chs
					.slice(starts.pop(), i)
					.join('')
				let argName = (
					argString.includes(' ')
						? argString.split(' ')[0]
						: argString
				).toLowerCase()
				let params = argString.includes(' ')
					? argString.split(' ').slice(1).join(' ')
					: ''
				let func = Actions.get(`$(${argName})`)
				if (func) {
					params = await Commands._parse(params, data)
					data.params = params
					let response = await func(data)
					finalString = `${finalString}${response}`
				}
			} else if (starts.length === 0) {
				// Not inside an argument, so add to the temp string
				finalString = `${finalString}${ch}`
			}
			i++
		}
	
		return finalString
	}
}

class AWS {
	static _accounts = new Map()
	static _set_accounts(accounts) {
		accounts.forEach((account) => {
			AWS._accounts.set(account.name, account)
		})
	}
	static async speakIrc(message, emotes, bitsAmount, voice, shouldQueue) {
		console.log(message, emotes, bitsAmount, voice, shouldQueue)
		let text = await Twitch.Utils.replaceEmotesAndCheermotes({ message, emotes, bitsAmount })
		AWS.speak(text, voice, shouldQueue)
	}
	static async speak(text, voice, shouldQueue) {
		try {
			if (text.trim().length === 0) {
				return
			}
			let request = {
				url: 'https://polly.us-east-1.amazonaws.com/v1/speech',
				method: 'POST',
				headers: {
					'content-type': 'application/x-amz-json-1.0',
					'Host': 'polly.us-east-1.amazonaws.com'
				},
				body: JSON.stringify({
					Engine: voice.split('-')[1],
					OutputFormat: 'ogg_vorbis',
					Text: `<speak><prosody rate="110%">${text}</prosody></speak>`,
					TextType: "ssml",
					VoiceId: voice.split('-')[0]
				})
			}
		
			let config = {
				service: 'polly',
				region: 'us-east-1',
				accessKeyId: AWS._accounts.get('user').id,
				secretAccessKey: AWS._accounts.get('user').secret
			}
		
			const ALGORITHM = 'AWS4-HMAC-SHA256'
			const textEnc = new TextEncoder('utf-8')
			const encode = textEnc.encode.bind(textEnc)
		
			const { service, region, secretAccessKey, accessKeyId } = config
			const { search, pathname } = new URL(request.url)
		
			request.headers['X-Amz-Date'] = new Date().toISOString().replace(/[:-]/g, '').replace(/\.\d\d\dZ/, 'Z')
		
			const dateFragment = request.headers['X-Amz-Date'].split('T')[0]
		
			const signableHeaderKeys = Object.keys(request.headers).filter(key => key.toLowerCase())
		
			const canonicalHeaderKeyList = signableHeaderKeys.map(key => key.toLowerCase()).sort().join(';')
		
			const bodyString = request.body
		
			const canonicalRequest = [
				request.method || (request.body ? 'POST' : 'GET'),
				service === 's3' ? encodeURI((pathname || '/')) : encodeURI(encodeURI((pathname || '/').replace(/\/+/g, '/'))),
				(search.replace(/^\?/, '') || '').split('&').sort().join('&'),
				signableHeaderKeys.map(key => `${key.toLowerCase().trim()}:${formatHeaderValue(request.headers[key])}`).sort().join('\n') + '\n',
				canonicalHeaderKeyList,
				await hash(bodyString || '')
			].join('\n')
		
			const hashedCanonicalRequest = await hash(canonicalRequest)
		
			const signingValues = [dateFragment, region, service, 'aws4_request']
		
			const credentialScope = signingValues.join('/')
		
			const stringToSign = [ALGORITHM, request.headers['X-Amz-Date'], credentialScope, hashedCanonicalRequest].join('\n')
		
			const { signature } = await hmacSignature({ secretAccessKey, signingValues, stringToSign })
		
			function formatHeaderValue(header) {
				if (typeof header === 'string') {
					return header.trim().replace(/ +/g, ' ')
				} else if (Array.isArray(header)) {
					return header.map(formatHeaderValue).join(',')
				}
				return ''
			}
		
			function hmacToHex(buffer) {
				return Array.prototype.map.call(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('')
			}
		
			async function hmac(bits, value, makeHex) {
				const key = await crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, [ 'sign' ])
				const result = await crypto.subtle.sign('HMAC', key, encode(value))
				return makeHex ? hmacToHex(result) : result
			}
		
			async function hmacSignature({ secretAccessKey, signingValues, stringToSign }) {
				let signingKey = encode(`AWS4${secretAccessKey}`)
				for (const value of signingValues) {
					signingKey = await hmac(signingKey, value)
				}
		
				const signature = await hmac(signingKey, stringToSign, true)
				signingKey = hmacToHex(signingKey)
		
				return { signature, signingKey }
			}
		
			async function hash(msg) {
				return hmacToHex(await crypto.subtle.digest('SHA-256', encode(msg)))
			}
		
			request.headers.Authorization = `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${canonicalHeaderKeyList}, Signature=${signature}`
			request.body = bodyString
		
			let req = await fetch(request.url, {
				body: request.body,
				method: request.method,
				headers: request.headers
			})

			let media = new Audio()
			media.src = URL.createObjectURL(await req.blob())
			media.oncanplaythrough = () => {
				media.play()
			}
		
			/*
			if (shouldQueue) {
				Media.play(null, {
					type: 'audio',
					queue: 'tts',
					src
				})
			} else {
				let media = new Audio()
				media.src = src
				media.oncanplaythrough = () => {
					media.play()
				}
			}			
			*/
		} catch (e) {
			console.error(e)
		}
	}
}

class Media {
	static _globalId = 0
	static _items = new Map()
	static _queues = new Map()

	static play(name, blob) {
		if (blob) {
			Media._prep(blob)
			return
		}
		// Get items from database
		let items = DB.get(`effects.${name}`)
		if (Utils.isNullOrEmpty(items)) {
			return
		}
		items.forEach((item) => {
			Media._prep(item)
		})
	}

	static async playTwitchClip(userId, callbacks) {
		try {
			let response = await Twitch.API.getClips({
				broadcaster_id: userId,
				first: 100
			})
			if (Utils.isNullOrEmpty(response)) {
				return ''
			}
			let clip = Utils.randomItem(response)
			/*
			let data = await Twitch.API.getGames({ id: clip.game_id })
			if (Utils.isNullOrEmpty(data)) {
				return
			}*/
			Media.play(null, {
				type: 'video',
				queue: 'clips',
				clip,
				src: `${clip.thumbnail_url.split('-preview-')[0]}.mp4`,
				dimensions: {
					width: 1280,
					height: 720,
				},
				position: {
					left: 0,
					top: 0
				},
				callbacks
			})
		} catch {
			return ''
		}
	}

	static _prep(item) {
		// Random position
		if (item.isPositionRandom) {
			item.position.left = Utils.getRandomNumber(0, 1920 - item.dimensions.width)
			item.position.top = Utils.getRandomNumber(0, 1080 - item.dimensions.height)			
		}

		// Set a z-index value that doubles as a tracking id
		Media._globalId ++
		item.id = Media._globalId
		Media._items.set(item.id, item)

		// Play immediately or add to queue
		if (!item.queue) {
			Media._play_media(item)
			return
		}
		Media._add_to_queue(item)
	}

	static _add_to_queue(item) {
		console.log(item)
		let queueName = item.queue
		if (!Media._queues.has(queueName)) {
			Media._queues.set(queueName, [])
		}
		let queue = Media._queues.get(queueName)
		
		if (queue.length === 0) {
			queue.push(item.id)
			Media._queues.set(queueName, queue)
			Media._next(item.queue)
			return
		}
		queue.push(item.id)
		Media._queues.set(queueName, queue)
	}

	static _next(queueName) {
		let queue = Media._queues.get(queueName)
		if (queue.length === 0) {
			return
		}
		let id = queue.at(0)
		if (!id) {
			return
		}
		let item = Media._items.get(id)
		Media._play_media(item)
	}

	static _play_media(item) {
		switch (item.type) {
			case 'audio': {
				item.media = new Audio()
				item.media.src = item.src
				item.media.oncanplaythrough = () => {
					item.media.play()
				}
				break
			}
			case 'video': {
				item.media = document.createElement('video')
				item.media.src = item.src
				item.media.width = item.dimensions.width
				item.media.height = item.dimensions.height
				item.media.oncanplaythrough = () => {
					item.media.play()
				}
				item.media.onplay = () => {
					try {
						item.callbacks.onplay(item)
					} catch {}
					item.media.hidden = false
				}
				item.media.onpause = () => {
					Media._items.set(item.id, item)
				}
				item.media.onended = async () => {
					item.media.hidden = true
					item.div.removeChild(item.media)
					document.body.removeChild(item.div)
					Media._items.delete(item.id)
					if (item.queue) {
						let queue = Media._queues.get(item.queue)
						queue.shift()
						Media._queues.set(queue)
						await Utils.wait(1_000)
						Media._next(item.queue)
					}
				}
				item.div = document.createElement('div')
				item.div.style.zIndex = item.id
				item.div.style.left = item.position.left
				item.div.style.top = item.position.top
				item.div.style.position = 'absolute'
				item.div.style.display = 'flex'
				item.div.appendChild(item.media)
				document.body.appendChild(item.div)
				break
			}
		}
	}

}

class Twitch {
	static _accounts = new Map()
	static _channels = new Map()
	static _bots = new Map()
	static _irc = new Map()
	static _anon
	static _eventsub

	static isBot(id) {
		return Twitch._bots.has(id)
	}

	static id(account) {
		return Twitch._accounts.get(account).id
	}

	static client(account) {
		return Twitch._accounts.get(account).client
	}

	static token(account) {
		return Twitch._accounts.get(account).token
	}

	static async listen(channels) {
		try {
			let users = await Twitch.API.getUsers(channels)
			if (Utils.isNullOrEmpty(users)) {
				throw new Error('no data')
			}
			let logins = Twitch._anon.channels
			users.forEach((user) => {
				if (!Twitch._channels.has(user.id)) {
					Twitch._channels.set(user.id, user)
				}
				if (logins.includes(user.login)) {
					return
				}
				logins.push(user.login)
			})
			Twitch._anon.channels = logins
			Twitch._anon.conn1.send(`JOIN #${logins.join(',')}`)
		} catch (e) {
			// TODO: Be less lazy
			console.error(e)
			location.reload()
		}
	}

	static async send(msg, id, sender) {
		try {
			let channel = Twitch._accounts.get('broadcaster').login
			let message = msg.replace(/\s\s+/g, ' ').trim()
			if (message.length === 0) {
				return
			}
			let prepend = id ? `@reply-parent-msg-id=${id} ` : ''
			let privmsgString = `${prepend}PRIVMSG #${channel} :${message}`
			Twitch._irc.get(sender ?? 'bot').conn1.send(privmsgString)
		} catch (e) {
			console.error(e)
			await Utils.wait(5_000)
			Twitch.send(msg, id, sender)
		}
	}

	static async _set_accounts(accounts) {
		try {
			Twitch._anon = new Twitch.IRC()
			let channels = []
			for await (const account of accounts) {
				if (!account.token) {
					continue
				}
				let users = await Twitch.API.getUsers(null, account)
				if (Utils.isNullOrEmpty(users)) {
					return
				}
				let user = users[0]
				user.client = account.client
				user.token = account.token
				Twitch._accounts.set(account.name, user)
				Twitch._channels.set(user.id, user)
				Twitch._irc.set(account.name, new Twitch.IRC(user.id))
				if (account.name === 'broadcaster') {
					channels.push(['id', user.id])
				} else {
					Twitch._bots.set(user.id, user)
				}
			}
			setTimeout(() => {
				Twitch.listen(channels)
			}, 5_000)
			Twitch._eventsub = new Twitch.EventSub()
		} catch (e) {
			console.error(e)
			location.reload()
		}
	}

	static API = class {
		static prefix = 'https://api.twitch.tv/helix'

		static headers(account) {
			return {
				'Authorization': `Bearer ${Twitch.token(account)}`,
				'Client-Id': Twitch.client(account),
				'Content-Type': 'application/json'
			}
		}

		// Ads
		static async startCommercial(length) {
			let url = new URL(Twitch.API.prefix + '/channels/commercial')
			let params = new URLSearchParams({
				broadcaster_id: Twitch.id('broadcaster'),
				length
			})
			url.search = String(params)
			let options = {
				method: 'POST',
				headers: Twitch.API.headers('broadcaster')
			}
			let response = await fetch(url, options)
			if (!response) {
				return
			}
			let data = await response.json()
			if (!data) {
				return
			}
			return data.data[0]
		}
		static async getAdSchedule() {
			let url = new URL(Twitch.API.prefix + '/channels/ads')
			let params = new URLSearchParams({
				broadcaster_id: Twitch.id('broadcaster')
			})
			url.search = String(params)
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
			let response = await fetch(url, options)
			if (!response) {
				return
			}
			let data = await response.json()
			if (!data) {
				return
			}
			return data.data[0]
		}
		static async snoozeNextAd() {}

		// Analytics
		static async getExtensionAnalytics() {}
		static async getGameAnalytics() {}

		// Bits
		static async getBitsLeaderboard() {}
		static async getCheermotes() {
			let url = new URL(Twitch.API.prefix + '/bits/cheermotes')
	
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
	
			let response = await fetch(url, options)
	
			if (!response.ok) {
				return
			}
	
			let d = await response.json()
			if (!d) {
				return
			}
			
			return d.data[0]
		}
		static async getExtensionTransactions() {}

		// Channels
		static async getChannelInformation(query) {
			let url = new URL(Twitch.API.prefix + '/channels')
			let params = new URLSearchParams(query)
			url.search = String(params)
	
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
	
			let response = await fetch(url, options)
	
			if (!response.ok) {
				return
			}
	
			let data = await response.json()
			return data.data
		}
		static async modifyChannelInformation(body) {
			let url = new URL(Twitch.API.prefix + '/channels')
			let params = new URLSearchParams({ broadcaster_id: Twitch.id('broadcaster') })
			url.search = String(params)
	
			let options = {
				method: 'PATCH',
				headers: Twitch.API.headers('broadcaster'),
				body: JSON.stringify(body)
			}
	
			let response = await fetch(url, options)
			return response.ok
		}
		static async getChannelEditors() {}
		static async getFollowedChannels() {}
		static async getChannelFollowers(query) {
			let url = new URL(Twitch.API.prefix + '/channels/followers')
			query.broadcaster_id = Twitch.id('broadcaster')
			let params = new URLSearchParams(query)
			url.search = String(params)
	
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
	
			let response = await fetch(url, options)
	
			if (!response.ok) {
				return
			}
	
			let followData = await response.json()
			return followData
		}

		// Channel Points
		static async createCustomRewards(body) {
			let url = new URL(Twitch.API.prefix + '/channel_points/custom_rewards')
			let params = new URLSearchParams({
				broadcaster_id: Twitch.id('broadcaster')
			})
			url.search = String(params)
			let options = {
				method: 'POST',
				headers: Twitch.API.headers('broadcaster'),
				body: JSON.stringify(body)
			}
			let response = await fetch(url, options)
			if (!response) {
				return
			}
			let data = await response.json()
			if (!data) {
				return
			}
			return data.data[0]
		}
		static async deleteCustomReward() {}
		static async getCustomReward() {}
		static async getCustomRewardRedemption() {}
		static async updateCustomReward(id, body) {
			let url = new URL(Twitch.API.prefix + '/channel_points/custom_rewards')
			let params = new URLSearchParams({
				broadcaster_id: Twitch.id('broadcaster'),
				id
			})
			url.search = String(params)
			let options = {
				method: 'PATCH',
				headers: Twitch.API.headers('broadcaster'),
				body: JSON.stringify(body)
			}
			let response = await fetch(url, options)
			if (!response) {
				return
			}
			let data = await response.json()
			if (!data) {
				return
			}
			return data.data[0]
		}
		static async updateRedemptionStatus() {}

		// Charity
		static async getCharityCampaign() {}
		static async getCharityCampaignDonations() {}

		// Chat
		static async getChatters() {}
		static async getChannelEmotes() {}
		static async getGlobalEmotes() {}
		static async getEmoteSets() {}
		static async getChannelChatBadges() {}
		static async getGlobalChatBadges() {}
		static async getChatSettings() {}
		static async updateChatSettings() {}
		static async sendChatAnnouncement(message, color) {
			let url = new URL(Twitch.API.prefix + '/chat/announcements')
			let params = new URLSearchParams({
				broadcaster_id: Twitch.id('broadcaster'),
				moderator_id: Twitch.id('bot')
			})
			url.search = String(params)
			let options = {
				method: 'POST',
				headers: Twitch.API.headers('bot'),
				body: JSON.stringify({
					message,
					color: color ?? 'primary'
				})
			}
			fetch(url, options)
		}
		static async sendShoutout(userId) {
			let url = new URL(Twitch.API.prefix + '/chat/shoutouts')
			let params = new URLSearchParams({
				from_broadcaster_id: Twitch.id('broadcaster'),
				to_broadcaster_id: userId,
				moderator_id: Twitch.id('bot')
			})
			url.search = String(params)
			let options = {
				method: 'POST',
				headers: Twitch.API.headers('bot')
			}
			fetch(url, options)
		}
		static async getUserChatColor() {}

		// Clips
		static async createClip(channelId) {
			let url = new URL(Twitch.API.prefix + '/clips')
			let params = new URLSearchParams({ broadcaster_id: channelId })
			url.search = String(params)
	
			let options = {
				method: 'POST',
				headers: Twitch.API.headers('bot')
			}
	
			let response = await fetch(url, options)
			if (!response.ok) {
				return
			}
	
			let r = await response.json()
			let clipId = r.data[0].id
			return clipId
		}
		static async getClips(query) {
			let url = new URL(Twitch.API.prefix + '/clips')
			let params = new URLSearchParams(query)
			url.search = String(params)
	
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('bot')
			}
	
			let response = await fetch(url, options)
			if (!response.ok) {
				return
			}
	
			let r = await response.json()
			return r.data
		}

		// CCLs
		static async getContentClassificationLabels() {}

		// Entitlements
		static async getDropsEntitlements() {}
		static async updateDropsEntitlements() {}

		// Extensions
		static async getExtensionConfigurationSegment() {}
		static async setExtensionConfigurationSegment() {}
		static async setExtensionRequiredConfiguration() {}
		static async sendExtensionPubSubMessage() {}
		static async getExtensionLiveChannels() {}
		static async getExtensionSecrets() {}
		static async createExtensionSecret() {}
		static async sendExtensionChatMessage() {}
		static async getExtensions() {}
		static async getReleasedExtensions() {}
		static async getExtensionBitsProducts() {}
		static async updateExtensionBitsProduct() {}

		// EventSub
		static async createEventSubSubscription(subData) {
			let url = new URL(Twitch.API.prefix + '/eventsub/subscriptions')
			let options = {
				method: 'POST',
				body: JSON.stringify(subData),
				headers: Twitch.API.headers('broadcaster')
			}
			let response = await fetch(url, options)
			return response
		}
		static async deleteEventSubSubscription(subscriptionId) {
			let url = new URL(Twitch.API.prefix + '/eventsub/subscriptions')
			let params = new URLSearchParams({ id: subscriptionId })
			url.search = params.toString()
			let options = {
				method: 'DELETE',
				headers: Twitch.API.headers('broadcaster')
			}
			let response = await fetch(url, options)
			return response
		}
		static async getEventSubSubscriptions() {
			let url = new URL(Twitch.API.prefix + '/eventsub/subscriptions')
			let params = new URLSearchParams({
				user_id: Twitch.id('broadcaster')
			})
			url.search = String(params)
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
			let response = await fetch(url, options)
			if (!response.ok) {
				return
			}
			let responseData = await response.json()
			if (!responseData) {
				return
			}
			return responseData.data
		}

		// Games
		static async getTopGames() {}
		static async getGames(query) {
			let url = new URL(Twitch.API.prefix + '/games')
			let params = new URLSearchParams(query)
			url.search = String(params)
	
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
	
			let response = await fetch(url, options)
	
			if (!response.ok) {
				return
			}
	
			let d = await response.json()
			return d.data
		}

		// Goals
		static async getCreatorGoals() {}

		// Guest Star
		static async getChannelGuestStarSettings() {}
		static async updateChannelGuestStarSettings() {}
		static async getGuestStarSession() {}
		static async createGuestStarSession() {}
		static async endGuestStarSession() {}
		static async getGuestStarInvites() {}
		static async sendGuestStarInvite() {}
		static async deleteGuestStarInvite() {}
		static async assignGuestStarSlot() {}
		static async updateGuestStarSlot() {}
		static async deleteGuestStarSlot() {}
		static async updateGuestStarSlotSettings() {}

		// Hype Train
		static async getHypeTrainEvents() {}

		// Moderation
		static async checkAutoModStatus() {}
		static async manageHeldAutoModMessages() {}
		static async getAutoModSettings() {}
		static async updateAutoModSettings() {}
		static async getBannedUsers() {}
		static async banUser() {}
		static async unbanUser() {}
		static async getBlockedTerms() {}
		static async addBlockedTerm() {}
		static async removeBlockedTerm() {}
		static async deleteChatMessages() {}
		static async getModeratedChannels() {}
		static async getModerators() {}
		static async addChannelModerator() {}
		static async removeChannelModerator() {}
		static async getVips() {}
		static async addChannelVip() {}
		static async removeChannelVip() {}
		static async updateShieldModeStatus() {}
		static async getShieldModeStatus() {}

		// Polls
		static async getPolls() {}
		static async createPoll() {}
		static async endPoll() {}

		// Predictions
		static async getPredictions() {}
		static async createPrediction() {}
		static async endPrediction() {}

		// Raids
		static async startRaid() {}
		static async cancelRaid() {}

		// Schedule
		static async getChannelStreamSchedule() {}
		static async getChannelIcalendar() {}
		static async updateChannelStreamSchedule() {}
		static async createChannelStreamScheduleSegment() {}
		static async updateChannelStreamScheduleSegment() {}
		static async deleteChannelStreamScheduleSegment() {}

		// Search
		static async searchCategories(query) {
			let url = new URL(Twitch.API.prefix + '/search/categories')
			let params = new URLSearchParams(query)
			url.search = String(params)
	
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
	
			let response = await fetch(url, options)
			if (!response.ok) {
				return
			}
	
			let data = await response.json()
			if (!data) {
				return
			}
			return data.data[0]
		}
		static async searchChannels() {}

		// Streams
		static async getStreamKey() {}
		static async getStreams(query) {
			let url = new URL(Twitch.API.prefix + '/streams')
			let params = new URLSearchParams(query)
			url.search = String(params)
	
			let options = {
				method: 'GET',
				headers: Twitch.API.headers('broadcaster')
			}
	
			let response = await fetch(url, options)
			if (!response.ok) {
				return
			}
	
			let r = await response.json()
			return r.data
		}
		static async getFollowedStreams() {}
		static async createStreamMarker() {}
		static async getStreamMarkers() {}

		// Subscriptions
		static async getBroadcasterSubscriptions() {}
		static async checkUserSubscription() {}

		// Teams
		static async getChannelTeams() {}
		static async getTeams() {}
	
		// Users
		static async getUsers(users, account) {
			let url = new URL(Twitch.API.prefix + '/users')
			let options = {
				method: 'GET'
			}

			if (account) {
				options.headers = {
					'Authorization': `Bearer ${account.token}`,
					'Client-Id': account.client,
					'Content-Type': 'application/json'
				}
			} else if (users) {
				let params = new URLSearchParams(users)
				url.search = String(params)
				options.headers = Twitch.API.headers('broadcaster')
			} else {
				return
			}
						
			let response = await fetch(url, options)
			if (!response.ok) {
				return
			}
	
			let r = await response.json()
			return r.data
		}
		static async updateUser() {}
		static async getUserBlockList() {}
		static async blockUser() {}
		static async unblockUser() {}
		static async getUserExtensions() {}
		static async getUserActiveExtensions() {}
		static async updateUserExtensions() {}
		
		// Videos
		static async getVideos() {}
		static async deleteVideos() {}

		// Whispers
		static async sendWhisper() {}
	
	}

	static IRC = class {
		conn1 = null
		conn2 = null
		receivedIds = new Map()
		id = null
		channels = []
	
		constructor(id) {
			this.id = id
			this.connect()
		}

		parse(message) {
			let i = 0
			let m = {
				command: '',
				channel: '',
				user: '',
				host: '',
				message: '',
				tags: {}
			}
		
			// Tags component
			if (message[i] === "@") {
				i += 1
				let endIdx = message.indexOf(' ', i)
				let rawTagsComponent = message.slice(i, endIdx)
				let newTags = {}
				rawTagsComponent.split(';').forEach(tag => {
					let splitParts = tag.split("=")
					let key = splitParts[0]
					let value = splitParts[1]
					if (key === 'client-nonce' || key === 'flags') {
						return
					}
					newTags[key] = value
					if (value === '') {
						return
					}
					switch (key) {
						case 'badge-info':
						case 'badges':
							let dictBadges = {}
							value.split(',').forEach(pair => {
								let badgeParts = pair.split('/')
								dictBadges[badgeParts[0]] = badgeParts[1]
							})
							newTags[key] = dictBadges
							break
						case 'emote-sets':
							newTags[key] = value.split(',')
							break
						case 'emotes':
							let dictEmotes = {}
							value.split('/').forEach(emote => {
								let emoteParts = emote.split(':')
								let textPositions = []
								let positions = emoteParts[1].split(',')
								positions.forEach(position => {
									let pos = position.split('-')
									textPositions.push([Number(pos[0]), Number(pos[1])])
								})
								dictEmotes[emoteParts[0]] = textPositions
							})
							newTags[key] = dictEmotes
							break
					}
				})
				m.tags = newTags
				i = endIdx + 1
			}
		
			// Source component
			if (message[i] === ':') {
				i += 1
				let endIdx = message.indexOf(' ', i)
				let rawSourceComponent = message.slice(i, endIdx)
				let sourceParts = rawSourceComponent.split('!')
				m.user = (sourceParts.length === 2) ? sourceParts[0] : ''
				m.host = (sourceParts.length === 2) ? sourceParts[1] : sourceParts[0]
				i = endIdx + 1
			}
		
			// Commands component
			let splitPoint = message.indexOf(':', i)
			let endIdx = (splitPoint === -1) ? message.length : splitPoint + 1
			let rawCommandComponent = message.slice(i, endIdx)
			let commandParts = rawCommandComponent.split(' #')
			m.command = (commandParts[0].split(' ')[0])
			m.channel = (commandParts.length === 2) ? commandParts[1].split(' ')[0] : ''
		
			// Paramaters component
			if (endIdx !== message.length) {
				i = endIdx
				let rawParametersComponent = message.slice(i)
				let messageParts = rawParametersComponent.split(`${String.fromCharCode(1)}ACTION `, i)
				if (messageParts.length === 2 && m.command === 'PRIVMSG') {
					m.message = messageParts[1].slice(0, -1)
					m.tags = (m.tags) ?? {}
					m.tags['slash-me'] = '1'
				} else {
					m.message = messageParts[0]
				}
			}
	
			return m
		}

		eventSender(m) {
			// User
			let userId = m.tags['user-id']
			let userLogin = m.user
			let userDisplay = m.tags['display-name']
			// Broadcaster
			let channelId = m.tags['room-id']
			let channelLogin = m.channel
			let channelDisplay = Twitch._channels.get(channelId).display_name
			// Roles
			let isBroadcaster = userId === channelId
			let isModerator = (m.tags.mod === '1' || userId === channelId) ? true : false
			// Message
			let msgId = m.tags.id
			let message = m.message
			let rewardId = m.tags['custom-reward-id']

			let commandName
				= message.charAt(0) === '!'
				? message.split(' ')[0].slice(1).toLowerCase()
				: null

			// Flags
			let isNewChatter = m.tags['first-msg'] === '1'
			// Attachments
			let bitsAmount = Number(m.tags.bits ?? 0)
			let emotes = m.tags.emotes

			let _data = {
				userId,
				userLogin,
				userDisplay,
				channelId,
				channelLogin,
				channelDisplay,
				isModerator,
				msgId,
				message,
				commandName,
				commandType: 'commands',
				bitsAmount,
				emotes
			}

			// All messages
			Events._emit('twitch.chat.message', _data)

			try {
				let entrance = Actions.get('$(entrance)')
				entrance({ userId })
			} catch {}

			// Commands & Keywords
			if (!Twitch.isBot(userId)) {
				Commands._keywords_and_commands(_data)
			}

		}

		token() {
			return Twitch._channels.get(this.id).token
		}
	
		connect() {
			try {
				let conn = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
			
				conn.onclose = (event) => {
					if (event.code !== 1000 ) {
						this.reconnect(`CLOSED (${event.code})`)
					}
				}
	
				conn.onopen = () => {
					if (this.id) {
						conn.send(`PASS oauth:${this.token()}`)
						conn.send('NICK _')
					} else {
						conn.send('PASS SCHMOOPIIE')
						conn.send('NICK justinfan69')
						conn.send('CAP REQ :twitch.tv/commands twitch.tv/membership twitch.tv/tags')
						if (this.channels.length > 0) {
							conn.send(`JOIN #${this.channels.join(',')}`)
						}
					}
				}
	
				conn.onmessage = (event) => {
					let raw = String(event.data)
					let messages = raw.split("\r\n")
					messages.pop()
					messages.forEach(message => {
						let m = this.parse(message)						
						switch (m.command) {
							case '001':
								this.conn2 = this.conn1
								this.conn1 = conn
								this.clearOldConnection()
								break
							case 'NOTICE':
								if (m.message !== 'Login authentication failed') {
									break
								}
								try {
									conn.close(1000)
								} catch {}
								break
							case 'RECONNECT':
								this.reconnect()
								break
							case 'PING':
								conn.send(`PONG :${m.message}`)
								break
							case 'PRIVMSG':
							case 'USERNOTICE':
								if (this.id) {
									break
								}
								let id = m.tags.id
								if (this.receivedIds.has(id)) {
									break
								}
								this.receivedIds.set(id, m.tags['tmi-sent-ts'])
								console.log(m)
								this.eventSender(m)
						}
					})
				}
			} catch (e) {
				this.reconnect(e)
			}
		}

		async reconnect(e) {
			if (e) {
				console.error(e)
				await Utils.wait(5_000)
			}
			this.connect()
		}

		clearOldConnection() {
			if (this.conn2) {
				try {
					this.conn2.close(1000)
				} catch {}
			}
		}
	}

	static EventSub = class {
		permalink = 'wss://eventsub.wss.twitch.tv/ws'
		url = this.permalink
		conn1 = null
		conn2 = null
		receivedIds = new Map()
		sessionId
		subs = [
			{
				type: "channel.update",
				version: "2",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.follow",
				version: "2",
				condition: {
					broadcaster_user_id: "broadcaster",
					moderator_user_id: "broadcaster"
				}
			},
			{
				type: "channel.ad_break.begin",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.chat.clear",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					user_id: "broadcaster"
				}
			},
			{
				type: "channel.chat.clear_user_messages",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					user_id: "broadcaster"
				}
			},
			{
				type: "channel.chat.message_delete",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					user_id: "broadcaster"
				}
			},
			{
				type: "channel.chat.notification",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					user_id: "broadcaster"
				}
			},
			{
				type: "channel.subscribe",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.subscription.end",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.subscription.gift",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.subscription.message",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.cheer",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.raid",
				version: "1",
				condition: {
					to_broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.raid",
				version: "1",
				condition: {
					from_broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.ban",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.unban",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.moderator.add",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.moderator.remove",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.channel_points_custom_reward.add",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.channel_points_custom_reward.update",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.channel_points_custom_reward.remove",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.channel_points_custom_reward_redemption.add",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.channel_points_custom_reward_redemption.update",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.poll.begin",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.poll.progress",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.poll.end",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.prediction.begin",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.prediction.progress",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.prediction.lock",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.prediction.end",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.charity_campaign.donate",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.charity_campaign.start",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.charity_campaign.progress",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.charity_campaign.stop",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.goal.begin",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.goal.progress",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.goal.end",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.hype_train.begin",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.hype_train.progress",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.hype_train.end",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "channel.shield_mode.begin",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					moderator_user_id: "broadcaster"
				}
			},
			{
				type: "channel.shield_mode.end",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					moderator_user_id: "broadcaster"
				}
			},
			{
				type: "channel.shoutout.create",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					moderator_user_id: "broadcaster"
				}
			},
			{
				type: "channel.shoutout.receive",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster",
					moderator_user_id: "broadcaster"
				}
			},
			{
				type: "stream.online",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "stream.offline",
				version: "1",
				condition: {
					broadcaster_user_id: "broadcaster"
				}
			},
			{
				type: "user.update",
				version: "1",
				condition: {
					user_id: "broadcaster"
				}
			}
		]

		constructor() {
			// Compile EventSub subscriptions
			let subs = []
			this.subs.forEach((sub) => {
				sub.transport = {
					method: "websocket"
				}
				Object.keys(sub.condition).forEach((key) => {
					sub.condition[key] = Twitch._accounts.get(sub.condition[key]).id
				})
				subs.push(sub)
			})
			this.subs = subs
			this.start()
		}

		async start() {
			// Delete old subscriptions
			await this.unsubscribe()
			this.connect()
		}

		eventSender(message) {
			let data = message.payload.event
			let eventName = message.metadata.subscription_type
			switch (eventName) {
				case 'channel.channel_points_custom_reward_redemption.add': {
					const reward = data.reward
					let commandName = reward.title
					let userId = data.user_id
					let userDisplay = data.user_name
					let message = data.user_input
					let _data = {
						commandType: 'redeems',
						commandName,
						userId,
						userDisplay,
						message
					}

					// All redemptions
					Events._emit(`twitch.${eventName}`, _data)
					
					// Quit if bot
					if (Twitch.isBot(userId)) {
						break
					}
					
					// Keywords & Commands
					Commands._keywords_and_commands(_data)
					break
				}
				case 'channel.raid': {
					let userId = data.from_broadcaster_user_id
					let userDisplay = data.from_broadcaster_user_name
					let viewers = data.viewers
					let _data = {
						userId,
						userDisplay,
						viewers
					}
					if (message.payload.subscription.condition.from_broadcaster_user_id) {
						Events._emit('twitch.raid.send', _data)
					} else {
						Events._emit('twitch.raid.receive', _data)
					}
					break
				}
				case 'channel.ad_break.begin': {
					let adDuration = data.duration_seconds
					let _data = {
						adDuration
					}
					Events._emit(`twitch.${eventName}`, _data)
					break
				}
				case 'stream.online': {
					let streamId = data.id
					this.onStreamStarted(streamId)
					let _data = {
						streamId
					}
					Events._emit(`twitch.${eventName}`, _data)
					break
				}
				case 'stream.offline': {
					let _data = {}
					Events._emit(`twitch.${eventName}`, _data)
					break
				}
				case 'user.update': {
					let userId = data.user_id
					let userLogin = data.user_login
					let userDisplay = data.user_name
					let _data = {}
					this.updateUser(userId, userLogin, userDisplay)
					Events._emit(`twitch.${eventName}`, _data)
					break
				}
				default:
					Events._emit(`twitch.${eventName}`, data)
			}
		}

		onStreamStarted(streamId) {
			let previousId = DB.get('stream.current_id') ?? '0'
			DB.set('stream.chatters', [])
			DB.set('stream.first', null)
			DB.set('stream.second', null)
			DB.set('stream.current_id', streamId)
			DB.set('stream.previous_id', previousId)
		}

		updateUser(userId, userLogin, userDisplay) {
			// Channels
			if (Twitch._channels.has(userId)) {
				let user = Twitch._channels.get(userId)
				user.login = userLogin
				user.display_name = userDisplay
				Twitch._channels.set(userId, user)
			}

			// Accounts
			let broadcaster = Twitch._accounts.get('broadcaster')
			broadcaster.login = userLogin
			broadcaster.display_name = userDisplay
			Twitch._accounts.set('broadcaster', broadcaster)

			// TODO: IRC channels
		}

		async unsubscribe() {
			try {
				let subs = await Twitch.API.getEventSubSubscriptions()
				if (subs.length === 0) {
					return
				}
	
				for await (const sub of subs) {
					if (sub.transport.method === 'webhook') {
						continue
					}
					let response = await Twitch.API.deleteEventSubSubscription(sub.id)
					if ([400, 401, 404].includes(response.status)) {
						continue
					} else if (!response.ok) {
						throw new Error(`${response.statusText} (${response.status})`)
					}
				}
			} catch (e) {
				console.error(e)
				await Utils.wait(1_000)
				this.unsubscribe()
			}
		}

		async subscribe(sessionId) {
			this.sessionId = sessionId
			try {
				for await (const data of this.subs) {
					if (sessionId !== this.sessionId) {
						return
					}
					data.transport.session_id = sessionId
					let response = await Twitch.API.createEventSubSubscription(data)
					if (!response.ok && sessionId === this.sessionId) {
						throw new Error(`${response.statusText} (${response.status})`)
					}
				}
			} catch (e) {
				this.reconnect(e)
			}
		}

		connect() {
			try {
				let conn = new WebSocket(this.url)
				this.url = this.permalink
	
				conn.onclose = (event) => {
					if (event.code !== 1000 ) {
						this.reconnect(`CLOSED (${event.code})`)
					}
				}
	
				conn.onmessage = (event) => {
					let message = JSON.parse(String(event.data))
					switch (message.metadata.message_type) {
						case 'session_welcome':
							this.conn2 = this.conn1
							this.conn1 = conn
							this.clearOldConnection()
							this.subscribe(message.payload.session.id)
							break
						case 'session_reconnect':
							this.url = message.payload.session.reconnect_url
							this.reconnect()
							break
						case 'revocation':
							try {
								conn.close(1000)
							} catch {}
							break
						case 'notification':
							let id = message.metadata.message_id
							if (this.receivedIds.has(id)) {
								break
							}
							this.receivedIds.set(id, message.metadata.message_timestamp)
							console.log(message)
							this.eventSender(message)
					}
				}
			} catch (e) {
				this.reconnect(e)
			}
		}

		async reconnect(e) {
			if (e) {
				console.error(e)
				// Delete old subscriptions
				await this.unsubscribe()
				await Utils.wait(5_000)
			}
			this.connect()
		}

		clearOldConnection() {
			if (this.conn2) {
				try {
					this.conn2.close(1000)
				} catch {}
			}
		}
	}

	static Utils = class {
		static emoteReplacements = new Map([
			[":)", ""],
			[":(", ""],
			[":D", ""],
			[">(", ""],
			[":|", ""],
			["O_o", ""],
			["B)", ""],
			[":O", ""],
			["<3", ""],
			[":/", ""],
			[";)", ""],
			[":P", ""],
			[";P", ""],
			["R)", ""]
		])
		static invalidReplacements = new Map ([
			["<", " less than "],
			[">", " greater than "],
			["=", " equals "],
			["\/", " "],
			[`"`, "'"],
			["@", " "],
			["&", " and "],
			[":", " "]
		])
		static replaceEmotes({ message, emotes }) {
			if (!(emotes && (Object.keys(emotes).length > 0))) {
				return message
			}
			let text = message
			let emotesDict = emotes
			let textArray = Array.from(text)
			let textSplit = text.split(" ")
			let emoteNames = {}
			let newTextArray = []
			Object.values(emotesDict).forEach((value) => {
				let start = value[0][0]
				let end = value[0][1] + 1
				let emoteText = textArray.slice(start, end).join('')
				emoteNames[emoteText] = Twitch.Utils.emoteReplacements.get(emoteText) ?? ""
			})
			textSplit.forEach((term) => {
				let replace = (emoteNames[term]) ?? term
				newTextArray.push(replace)
			})
			text = newTextArray.join(' ').replace(/\s\s+/g, " ").trim()
			return text
		}

		static async replaceEmotesAndCheermotes({ message, emotes, bitsAmount }) {
			let text = Twitch.Utils.replaceEmotes({ message, emotes })
			if (bitsAmount && bitsAmount > 0) {
				const cheermotes = []
				let response = await Twitch.API.getCheermotes()
				response.forEach((dat) => {
					cheermotes.push(dat)
				})
				cheermotes.forEach((cheermote) => {
					let prefix = cheermote.prefix
					let regexObj = new RegExp(`${prefix}\d+`, "gi")
					text = text.replace(regexObj, "")
				})
			}
			text = Twitch.Utils.replaceInvalids(text)
			return text
		}

		static replaceInvalids(text) {
			Twitch.Utils.invalidReplacements.forEach((value, key, map) => {
				let regexObj = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
				text = text.replace(regexObj, value)
			})
			// Links
			text = text.replace(/\.\.+/g, ". ") // Reduce multiple periods to one
			text = text.replace(/\S+\.\S+/g, "")
			// Emoji
			text = text.replace(/\p{So}/ug, "")
			// Whitespace
			text = text.replace(/\s\s+/g, " ").trim()
			return text
		}
	}

}

class Discord {
	static _accounts = new Map()

	static client(account) {
		return Discord._accounts.get(account).client
	}

	static token(account) {
		return Discord._accounts.get(account).token
	}

	static connect(accounts) {
		accounts.forEach((account) => {
			account.gateway = new Discord.Gateway(account.token)
			Discord._accounts.set(account.name, account)
		})
	}

	static Gateway = class {
		gateway = 'https://discord.com/api/v10/gateway'
		gatewayPermalink = ''
		resumeGatewayUrl = ''
		url = ''
		sessionId = 0
		s = 0
		intents = 0
		loop = null
		conn = null
		token = ''
	
		constructor(token) {
			this.token = token
			this.setIntents()
			this.setGateway()
		}

		setIntents() {
			for (const [key, value] of Object.entries({
				GUILDS: 1 << 0,
				GUILD_MEMBERS: 1 << 1,
				GUILD_MODERATION: 1 << 2,
				GUILD_EMOJIS_AND_STICKERS: 1 << 3,
				GUILD_INTEGRATIONS: 1 << 4,
				GUILD_WEBHOOKS: 1 << 5,
				GUILD_INVITES: 1 << 6,
				GUILD_VOICE_STATES: 1 << 7,
				GUILD_PRESENCES: 1 << 8,
				GUILD_MESSAGES: 1 << 9,
				GUILD_MESSAGE_REACTIONS: 1 << 10,
				GUILD_MESSAGE_TYPING: 1 << 11,
				DIRECT_MESSAGES: 1 << 12,
				DIRECT_MESSAGE_REACTIONS: 1 << 13,
				DIRECT_MESSAGE_TYPING: 1 << 14,
				MESSAGE_CONTENT: 1 << 15,
				GUILD_SCHEDULED_EVENTS: 1 << 16,
				AUTO_MODERATION_CONFIGURATION: 1 << 20,
				AUTO_MODERATION_EXECUTION: 1 << 21
			})) {
				this.intents += value
			}
		}
	
		async setGateway() {
			let url = (await(await fetch(this.gateway)).json()).url
			this.gatewayPermalink = url
			this.resumeGatewayUrl = ''
			this.url = url
			this.connect()
		}

		eventSender(message) {
			Events._emit(`discord.${message.t}`, message.d)
		}
	
		connect() {
			let conn = new WebSocket(this.url)

			conn.onopen = () => {
				this.conn = conn
				if (this.url === this.gatewayPermalink) {
					this.send({
						op: 2,
						d: {
							token: this.token,
							properties: {
								os: 'web',
								browser: 'chrome',
								device: 'generic'
							},
							intents: this.intents
						}
					})
				} else {
					this.send({
						op: 6, 
						d: {
							token: this.token,
							session_id: this.sessionId,
							seq: this.s
						}
					})
				}
				this.url = this.gatewayPermalink
			}

			conn.onclose = (event) => {
				if (event.code !== 1000 ) {
					this.reconnect(event.code === 4999 ? null : `CLOSED (${event.code})`)
				}
			}

			conn.onmessage = (event) => {
				let message = JSON.parse(String(event.data))
				console.log(message)
				switch (message.op) {
					case 10: // HELLO
						this.loop = setInterval(() => {
							this.send({ op: 1, d: this.s })
						}, message.d.heartbeat_interval)
						break
					case 11: // HEARTBEAT_ACK
						break
					case 9: // INVALID_SESSION
						this.url = this.gatewayPermalink
						conn.close(4998)
						break
					case 7: // RECONNECT
						conn.close(4999)
						break
					case 0: // DISPATCH
						this.s = message.s
						switch (message.t) {
							case 'READY':
								this.sessionId = message.d.session_id
								this.resumeGatewayUrl = message.d.resume_gateway_url
							default:
								this.eventSender(message)
						}
				}
			}
		}

		async reconnect(e) {
			if (this.loop) {
				clearInterval(this.loop)
			}
			if (e) {
				console.error(e)
				await Utils.wait(5_000)
			}
			this.connect()
		}

		send(message) {
			if (this.conn) {
				try {
					this.conn.send(JSON.stringify(message))
				} catch {}
			}
		}
	}
}

class Utils {
	static async wait(timeMs) {
		let promise = new Promise((resolve) => {
			setTimeout(() => {
				resolve()
			}, timeMs)
		})
		return promise
	}

	static getRandomNumber(min, max) {
		min = Math.ceil(min)
		max = Math.floor(max)
		let number = Math.floor(Math.random() * (max - min + 1) + min)
		return number
	}

	static randomItem(list) {
		return list[Utils.getRandomNumber(0, list.length - 1)]
	}

	static isNullOrEmpty(data) {
		return !data || data.length === 0
	}

	static removeLeadingAtSymbol(text) {
		if (text.length === 0) {
			return ''
		}
		if (text.charAt(0) === '@') {
			return text.slice(1)
		}
		return text
	}

	static isPositiveIntegerAboveZero(n) {
		let quoteNum = Number(n)
		if (isNaN(quoteNum)) {
			return false
		}
		if (quoteNum < 1) {
			return false
		}
		return Math.floor(quoteNum)
	}

	static compareDates(dateString) {
		const userDate = new Date(dateString)
		const nowDate = new Date(Date.now())
	
		let years = nowDate.getFullYear() - userDate.getFullYear()
		let months = nowDate.getMonth() - userDate.getMonth()
		let days = nowDate.getDate() - userDate.getDate()
		let hours = nowDate.getHours() - userDate.getHours()
		let minutes = nowDate.getMinutes() - userDate.getMinutes()
		let seconds = nowDate.getSeconds() - userDate.getSeconds()
	
		if (seconds < 0) {
			minutes--
			seconds = seconds + 60
		}
	
		if (minutes < 0) {
			hours--
			minutes = minutes + 60
		}
	
		if (hours < 0) {
			days--
			hours = hours + 24
		}
	
		if (days < 0) {
			months--
			switch (userDate.getMonth()) {
				case 0:
				case 2:
				case 4:
				case 6:
				case 7:
				case 9:
				case 11:
					days = days + 31
					break
				case 3:
				case 5:
				case 8:
				case 10:
					days = days + 30
					break
				case 1:
					if (userDate.getFullYear() / 4 === 1) {
						days = days + 29
					} else {
						days = days + 28
					}
					break
			}
		}
	
		if (months < 0) {
			years--
			months = months + 12
		}
	
		let result = []
		if (years > 0) {
			result.push(years === 1 ? `${years} year` : `${years} years`)
		}
		if (months > 0) {
			result.push(
				months === 1 ? `${months} month` : `${months} months`
			)
		}
		if (days > 0) {
			result.push(days === 1 ? `${days} day` : `${days} days`)
		}
		if (hours > 0) {
			result.push(hours === 1 ? `${hours} hour` : `${hours} hours`)
		}
		if (minutes > 0) {
			result.push(
				minutes === 1
					? `${minutes} minute`
					: `${minutes} minutes`
			)
		}
		if (seconds > 0) {
			result.push(
				seconds === 1
					? `${seconds} second`
					: `${seconds} seconds`
			)
		}
	
		let stringAgo = ''
		switch (result.length) {
			case 0:
				stringAgo = `just now`
				break
			case 1:
				stringAgo = `${result[0]}`
				break
			default:
				stringAgo = `${result[0]}, ${result[1]}`
				break
		}
	
		let dt = new Intl.DateTimeFormat('en-US', {
			dateStyle: 'full',
			timeStyle: 'long',
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Australia/Queensland'
		})
		let dateTime = dt.format(userDate)
		stringAgo = `${stringAgo} -> ${dateTime}`
	
		return stringAgo
	}
}

class Actions {
	static _functions = new Map([
		['AWS.speakIrc', AWS.speakIrc],
		['DB.get', DB.get],
		['Media.play', Media.play],
		['Media.playTwitchClip', Media.playTwitchClip],
		['Twitch.send', Twitch.send],
		['Twitch.API.sendShoutout', Twitch.API.sendShoutout],
		['Utils.wait', Utils.wait],
		['Utils.getRandomNumber', Utils.getRandomNumber],
		['$(time)', ({ params }) => {
			try {
				let time = (new Intl.DateTimeFormat('en-US', {
					timeStyle: 'short',
					timeZone: params || (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/Toronto')
				})).format(new Date(Date.now()))
				return time
			} catch {
				return ''
			} 
		}],
		['$(fx)', ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				Media.play(params)
				return ''
			} catch {
				return ''
			}
		}],
		['$(fxset)', ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let effects = DB.get(`effects_set.${params}`) ?? []
				if (effects.length === 0) {
					return ''
				}
				effects = effects[0]
				let items = effects.items
				let min = effects.min ?? 0
				let max = effects.max ?? items.length - 1
				let value = Utils.getRandomNumber(min, max)

				let effect = items[0]
				if (!effects.min) {
					effect = items[value]
				} else {
					let i = -1
					for (const item of items) {
						i ++
						if (value >= item.min && value <= item.max) {
							effect = items[i]
							break
						}
					}
				}

				let msg = (effects.singular && value === 1)
					? effects.singular
					: (effects.plural ?? '')
				
				msg = msg.replace(/\$\(#\)/g, String(value)).trim()

				Media.play(effect.name)
				return msg
			} catch {
				return ''
			}
		}],
		['$(channel)', ({ channelId }) => {
			try {
				return Twitch._channels.get(channelId).display_name
			} catch {
				return ''
			}
		}],
		['$(tochannel)', ({ message, channelDisplay }) => {
			try {
				let splitParts = message.split(' ')
				let user = Utils.removeLeadingAtSymbol(splitParts.length < 2 ? channelDisplay : splitParts[1])
				return user
			} catch {
				return ''
			}
		}],
		['$(user)', ({ userDisplay }) => {
			try {
				return userDisplay
			} catch {
				return ''
			}
		}],
		['$(touser)', ({ message, userDisplay }) => {
			try {
				let splitParts = message.split(' ')
				let user = Utils.removeLeadingAtSymbol(splitParts.length < 2 ? userDisplay : splitParts[1])
				return user
			} catch {
				return ''
			}
		}],
		['$(query)', ({ message }) => {
			try {
				if (!message.includes(' ')) {
					return ''
				}
				let query = message.split(' ').slice(1).join(' ')
				return query
			} catch {
				return ''
			}
		}],
		['$(title)', async ({ params, channelId, channelLogin }) => {
			try {
				let broadcaster_id = channelId
				if (params && params.lower() !== channelLogin) {
					let users = await Twitch.API.getUsers({ login: params.lower() })
					if (Utils.isNullOrEmpty(users)) {
						return ''
					}
					broadcaster_id = users[0].id
				}
				let data = await Twitch.API.getChannelInformation({ broadcaster_id })
				if (Utils.isNullOrEmpty(data)) {
					return ''
				}
				let resp = data[0].title
				return resp
			} catch {
				return ''
			}
		}],
		['$(category)', async ({ params, channelId, channelLogin }) => {
			try {
				let broadcaster_id = channelId
				if (params && params.lower() !== channelLogin) {
					let users = await Twitch.API.getUsers({ login: params.lower() })
					if (Utils.isNullOrEmpty(users)) {
						return ''
					}
					broadcaster_id = users[0].id
				}
				let data = await Twitch.API.getChannelInformation({ broadcaster_id })
				if (Utils.isNullOrEmpty(data)) {
					return ''
				}
				let resp = data[0].game_name
				return resp
			} catch {
				return ''
			}
		}],
		['$(followcount)', async () => {
			try {
				let followData = await Twitch.API.getChannelFollowers({ first: 1 })
				if (!followData) {
					return ''
				}
				let followCount = followData.total
				return followCount
			} catch {
				return ''
			}
		}],
		['$(random)', ({ params }) => {
			try {
				let parts = params.split(' ')
				let min = parts[0].trim()
				let max = parts[1].trim()
				if (isNaN(min) || isNaN(max)) {
					return ''
				}
				return String(Utils.getRandomNumber(min, max))
			} catch {
				return ''
			}
		}],
		['$(count)', ({ params }) => {
			try {
				let key = `counts.${params}`
				let value = DB.get(key) ?? 0
				value ++
				DB.set(key, value)
				let val = String(value)
				return val
			} catch {
				return ''
			}
		}],
		['$(shoutout)', async ({ params, channelId }) => {
			try {
				let userId = channelId
				if (!Utils.isNullOrEmpty(params)) {
					let user = await Twitch.API.getUsers({ login: params.toLowerCase() })
					if (!Utils.isNullOrEmpty(user)) {
						userId = user[0].id
					}
				}
				Media.playTwitchClip(userId, { onplay: (item) => {
					Twitch.send(`https://twitch.tv/${item.clip.broadcaster_name}`)
				}})
				return ''
			} catch {
				return ''
			}
		}],
		['$(clip)', async ({ channelId, msgId }) => {
			let errorMsg = 'Try again later'
			try {
				Twitch.send('Creating clip...', msgId, 'bot')

				let id = await Twitch.API.createClip(channelId)
				if (!id) {
					return errorMsg
				}
		
				// Wait 15 seconds
				await Utils.wait(15_000)
		
				// Validate
				let rData = await Twitch.API.getClips({ id })
				if (Utils.isNullOrEmpty(rData)) {
					return errorMsg
				}

				return `https://clips.twitch.tv/${id}`
			} catch {
				return errorMsg
			}
		}],
		['$(addcommand)', ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
			
				let args = params.split(' ')
				if (args.length === 0) {
					return 'command name is required'
				}
				if (args.length === 1) {
					return 'command info is required'
				}
			
				// Command name
				let name = args[0].toLowerCase()
				if (name.length > 1 && name.charAt(0) === '!') {
					name = name.slice(1)
				}
			
				// Command info
				let text = args.slice(1).join(' ')
			
				// Database
				let key = `commands.${name}`
				if (DB.has(key)) {
					return `command [${name}] already exists`
				}
				let command = [
					{
						text,
						isReply: true,
						account: 'bot'
					}
				]
				DB.set(key, command)
				return `command [${name}] added`
			} catch {
				return ''
			}
		}],
		['$(editcommand)', ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
			
				let args = params.split(' ')
				if (args.length === 0) {
					return 'command name is required'
				}
				if (args.length === 1) {
					return 'command info is required'
				}
			
				// Command name
				let name = args[0].toLowerCase()
				if (name.length > 1 && name.charAt(0) === '!') {
					name = name.slice(1)
				}
			
				// Command info
				let text = args.slice(1).join(' ')
			
				// Database
				let key = `commands.${name}`
				if (!DB.has(key)) {
					return `command [${name}] not found`
				}
			
				let command = DB.get(key)
				command[0].text = text
				DB.set(key, command)
				return `command [${name}] edited`
			} catch {
				return ''
			}
		}],
		['$(delcommand)', ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
			
				let args = params.split(' ')
				if (args.length === 0) {
					return 'command name is required'
				}
			
				// Command name
				let name = args[0].toLowerCase()
				if (name.length > 1 && name.charAt(0) === '!') {
					name = name.slice(1)
				}
			
				// Database
				let key = `commands.${name}`
				if (!DB.has(key)) {
					return `command [${name}] not found`
				}
				DB.remove(key)
				return `command [${name}] deleted`
			} catch {
				return ''
			}
		}],
		['$(followage)', async ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let getUsersRes = await Twitch.API.getUsers([['login', params.toLowerCase()]])
				if (Utils.isNullOrEmpty(getUsersRes)) {
					return ''
				}
				let data = await Twitch.API.getChannelFollowers({ user_id: getUsersRes[0].id })
				if (!data) {
					return ''
				}
				if (data.data.length === 0) {
					return `${getUsersRes[0].display_name} does not follow the channel`
				}
				let compString = Utils.compareDates(data.data[0].followed_at)
				return compString
			} catch {
				return ''
			}
		}],
		['$(accountage)', async ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let data = await Twitch.API.getUsers([['login', params.toLowerCase()]])
				if (Utils.isNullOrEmpty(data)) {
					return ''
				}
				let compString = Utils.compareDates(data[0].created_at)
				return compString
			} catch {
				return ''
			}
		}],
		['$(settitle)', async ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let modifyData = await Twitch.API.modifyChannelInformation({ title: params })
				if (!modifyData) {
					return 'something went wrong'
				}
				return `title updated -> ${title}`
			} catch {
				return ''
			}
		}],
		['$(setgame)', async ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let game = await Twitch.API.searchCategories({
					query: params,
					first: 1
				})
				if (Utils.isNullOrEmpty(game)) {
					return ''
				}
				let modifyData = await Twitch.API.modifyChannelInformation({
					game_id: game.id
				})
				if (!modifyData) {
					return 'something went wrong'
				}
				return `category updated -> ${game.name}`
			} catch {
				return ''
			}
		}],
		['$(addquote)', async ({ params, userId, userDisplay, channelId, channelDisplay }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				// Message
				let message = params
				while (message.includes(`"`)) {
					message = message.replace(`"`, ``)
				}
				let splitParts = message.split('-')
				let splitEnd = splitParts.length - 1
			
				// Author
				let authorId = channelId
				let authorDisplay = channelDisplay
				if (splitParts.length > 1) {
					let author = Utils.removeLeadingAtSymbol(splitParts[splitEnd].trim())
					if (author.includes(',')) {
						author = author.split(',')[0].trim()
					}
					let data = await Twitch.API.getUsers({ login: author })
					if (Utils.isNullOrEmpty(data)) {
						return ''
					}
					authorId = data[0].id
					authorDisplay = data[0].display_name
					message = splitParts.slice(0, splitEnd).join('-')
				}
		
				// Category
				let cat = await Twitch.API.getStreams({ user_id: channelId })
				if (!cat) {
					return ''
				}
				let category
				if (cat.length === 0) {
					category = '0' // return 'the channel is offline'
				} else {
					category = cat[0].game_id
				}
			
				// Save
				let quotes = DB.get('quotes') ?? []
				quotes.push({
					message,
					author: {
						id: authorId,
						display_name: authorDisplay
					},
					category,
					submitter: {
						id: userId,
						display_name: userDisplay
					},
					timestamp: Date.now()
				})
				DB.set('quotes', quotes)
				return `quote #${quotes.length} added -> "${message}" - ${authorDisplay}`
			} catch {
				return ''
			}
		}],
		['$(editquote)', async ({ params, channelId, channelDisplay }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
			
				let args = params.split(' ')
				if (args.length === 0) {
					return 'quote number missing'
				}
				if (args.length === 1) {
					return 'quote info missing'
				}
			
				// Get #
				let n = Utils.isPositiveIntegerAboveZero(args[0])
				if (!n) {
					return 'invalid number'
				}
			
				// Get quote
				let quotes = DB.get('quotes') ?? []
				if (quotes.length === 0) {
					return 'no quotes found'
				}
				if (n > quotes.length) {
					return `only ${quotes.length} quote${quotes.length === 1 ? '' : 's'} found`
				}
				let quote = quotes[n - 1]
				
				// Message
				let message = args.slice(1).join(' ')
				while (message.includes(`"`)) {
					message = message.replace(`"`, ``)
				}
				let splitParts = message.split('-')
				let splitEnd = splitParts.length - 1
			
				// Author
				let authorId = channelId
				let authorDisplay = channelDisplay
				if (splitParts.length > 1) {
					let author = Utils.removeLeadingAtSymbol(splitParts[splitEnd].trim())
					if (author.includes(',')) {
						author = author.split(',')[0].trim()
					}
					let data = await Twitch.API.getUsers({ login: author })
					if (Utils.isNullOrEmpty(data)) {
						return ''
					}
					authorId = data[0].id
					authorDisplay = data[0].display_name
					message = splitParts.slice(0, splitEnd).join('-')
				}
		
				// Save
				quote.message = message
				quote.author.id = authorId
				quote.author.display_name = authorDisplay
				quotes[n - 1] = quote
				DB.set('quotes', quotes)
				return `quote #${n} edited -> "${message}" - ${authorDisplay}`
			} catch {
				return ''
			}
		}],
		['$(delquote)', ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let n = Utils.isPositiveIntegerAboveZero(params.split(' ')[0])
				if (!n) {
					return 'invalid number'
				}
				let quotes = DB.get('quotes') ?? []
				if (quotes.length === 0) {
					return 'no quotes found'
				}
				if (n > quotes.length) {
					return `only ${quotes.length} quote${quotes.length === 1 ? '' : 's'} found`
				}
				let quote = quotes.splice(n - 1, 1)[0]
				DB.set('quotes', quotes)
				return `quote #${n} deleted -> "${quote.message}" - ${quote.author.display_name}`
			} catch {
				return ''
			}
		}],
		['$(quote)', ({ params }) => {
			try {
				// Quotes
				let quotes = DB.get('quotes') ?? []
				if (quotes.length === 0) {
					return 'no quotes found'
				}
			
				// Quote #
				let n
				if (Utils.isNullOrEmpty(params)) {
					n = Utils.getRandomNumber(1, quotes.length)
				} else {
					n = Utils.isPositiveIntegerAboveZero(params)
					if (!n) {
						return 'invalid number'
					}
					if (n > quotes.length) {
						return `only ${quotes.length} quotes exist`
					}
				}
		
				// Quote
				let quote = quotes[n - 1]
				let quoteMessage = quote.message
				let authorDisplay = quote.author.display_name
				return `quote #${n} -> "${quoteMessage}" - ${authorDisplay}`
			} catch {
				return ''
			}
		}],
		['$(first)', ({ userId, userDisplay }) => {
			try {
				let firstKey = 'stream.first'
				let secondKey = 'stream.second'
				let first = DB.get(firstKey) ?? null
				let second = DB.get(secondKey) ?? null
				if (!first) {
					DB.set(firstKey, userId)
					Media.play('first')
					return `/me ${userDisplay} is first! Congratulations!`
				} else if (!second && userId !== first) {
					DB.set(secondKey, userId)
					return ''
				}
				return ''
			} catch {
				return ''
			}
		}],
		['$(entrance)', ({ userId }) => {
			try {
				let key = 'stream.chatters'
				let chatters = DB.get(key) ?? []
				if (chatters.includes(userId)) {
					return ''
				}
				chatters.push(userId)
				DB.set(key, chatters)
				if (!DB.has(`effects.entrance_${userId}`)) {
					return ''
				}
				Media.play(`entrance_${userId}`)
				return ''
			} catch {
				return ''
			}
		}],
		['$(exit)', ({ userId, userDisplay }) => {
			try {
				let key = 'stream.chatters'
				let chatters = DB.get(key)
				if (!chatters.includes(userId)) {
					return ''
				}
				chatters.splice(chatters.indexOf(userId))
				DB.set(key, chatters)
				let effectKey = DB.has(`effects.exit_${userId}`) ? `exit_${userId}` : 'lurk'
				Media.play(effectKey)
				return `/me ${userDisplay} is now lurking!`
			} catch {
				return ''
			}
		}],
		['$(daily)', ({ userId }) => {
			try {
				let userDB = DB.get(userId) ?? {}
				let count = String((userDB.dailies ?? 0) + 1)
				userDB.dailies = parseInt(count)
				DB.set(userId, userDB)
				return count
			} catch {
				return 'some amount'
			}
		}],
		['$(bool)', ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let splitParts = params.split(' ')
				if (splitParts.length < 2) {
					return ''
				}
				let key = `flags.${splitParts[0]}`
				let value = JSON.parse(splitParts[1])
				DB.set(key, value)
				return ''
			} catch {
				return ''
			}
		}],
		['$(wait)', async ({ params }) => {
			try {
				if (Utils.isNullOrEmpty(params)) {
					return ''
				}
				let time = parseInt(params) * 1_000
				await Utils.wait(time)
				return ''
			} catch {
				return ''
			}
		}]
	])
	static set(name, func) {
		Actions._functions.set(String(name).toLowerCase(), func)
	}
	static get(name) {
		return Actions._functions.get(String(name).toLowerCase())
	}
	static _has(name) {
		return Actions._functions.has(String(name).toLowerCase())
	}
	static _remove(name) {
		Actions._functions.delete(String(name).toLowerCase())
	}
	static async _call(name, data) {
		let func = Actions._functions.get(String(name).toLowerCase())
		if (!func) {
			return ''
		}
		let response = await func(data)
		return response
	}
	static _install(list) {
		list.forEach((item) => {
			Events.register(item.eventName, (data) => {
				Actions._nested(item.data, data)
			})
		})
	}
	static async _nested(condition, data) {
		if (Object.hasOwn(condition, 'if') && condition.if !== null) {
			// Get the pair of values
			let values = await Actions._parse_args(condition.if.data, data)

			// Compare the values for a result
			let result
			switch (condition.if.value) {
				case 'equals':
					result = values[0] === values[1]
					break
				case 'greater_or_equals':
					result = values[0] >= values[1]
					break
			}
			let next = result ? condition.then.data : condition.else.data
			await Actions._parse_args(next, data)
			return
		}
	}
	static async _parse_args(list, data) {
		let values = []
		for await (const item of list) {
			switch (item.type) {
				case 'property': {
					values.push(data[item.value])
					break
				}
				case 'string[]': {
					let args = await Actions._parse_args(item.data, data)
					let value = ''
					args.forEach((arg) => {
						value = `${value}${arg}`
					})
					values.push(value)
					break
				}
				case 'action': {
					let func = Actions._functions.get(item.value)
					let args = await Actions._parse_args(item.data, data)
					let value = await func(...args)
					values.push(value)
					break
				}
				default: {
					values.push(item.value)
					break
				}
			}
		}
		return values
	}
}
