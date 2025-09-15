require('dotenv').config()
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require('discord.js')

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
})

const ZKILL_CHAR_ID = '1761654327'
const ZKILL_CHANNEL_ID = '1416911551960711291'
const ZKILL_DEBUG = process.env.ZKILL_DEBUG === '1'
const ZKILL_REDISQ_URL = 'https://zkillredisq.stream/listen.php'
const ZKILL_TTW = 10

const seenKillmails = new Set()
const seenQueue = []
const markSeen = (id) => {
  if (seenKillmails.has(id)) return
  seenKillmails.add(id)
  seenQueue.push(id)
  if (seenQueue.length > 500) {
    const old = seenQueue.shift()
    seenKillmails.delete(old)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ZKILL_BACKOFF_MS = ZKILL_TTW * 1000
const CHAR_ID = Number(ZKILL_CHAR_ID)

async function zKillLoop() {
  let channel = client.channels.cache.get(ZKILL_CHANNEL_ID)
  if (!channel)
    channel = await client.channels.fetch(ZKILL_CHANNEL_ID).catch(() => null)

  const queueID = `WOPR-${client.user.id}`

  const baseUrl = new URL(ZKILL_REDISQ_URL)
  baseUrl.searchParams.set('queueID', queueID)
  baseUrl.searchParams.set('ttw', String(ZKILL_TTW))
  const base = baseUrl.toString()

  for (;;) {
    const tickStart = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        Math.max(5000, (ZKILL_TTW + 5) * 1000),
      )
      let res
      try {
        res = await fetch(base, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'WOPR (Discord Bot)',
            Accept: 'application/json',
          },
        })
      } finally {
        clearTimeout(timeout)
      }
      if (!res.ok) {
        if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after'))
          const backoff = isFinite(ra) && ra > 0 ? ra * 1000 : ZKILL_BACKOFF_MS
          console.log(
            `[zkill] 429 rate limited; ${Math.round(backoff / 1000)}s`,
          )
          await sleep(backoff)
        } else {
          console.log(`[zkill] http ${res.status} ${res.statusText}`)
        }
        continue
      }
      const data = await res.json().catch((e) => {
        console.log('[zkill] json error', e?.message || e)
        return {}
      })
      const pkg = data?.package
      if (!pkg) {
        if (ZKILL_DEBUG) console.log('[zkill] tick')
        continue
      }

      const km = pkg.killmail
      const zkb = pkg.zkb || {}

      const id = km?.killmail_id
      if (!id || seenKillmails.has(id)) continue

      const attackers = Array.isArray(km?.attackers) ? km.attackers : []
      const involved =
        attackers.some((a) => Number(a?.character_id) === CHAR_ID) ||
        Number(km?.victim.character_id) === CHAR_ID

      if (!involved) {
        if (ZKILL_DEBUG) console.log(`[zkill] skip: ${id}`)
        markSeen(id)
        continue
      }

      const link = `https://zkillboard.com/kill/${id}/`
      const shipId = km?.victim?.ship_type_id || null

      const isLoss = Number(km?.victim?.character_id) === CHAR_ID
      const isPod = shipId === 670

      const totalValue = zkb?.totalValue
        ? `${Math.round(zkb.totalValue).toLocaleString()} ISK`
        : ''
      const droppedValue = zkb?.droppedValue
        ? `${Math.round(zkb.droppedValue).toLocaleString()} ISK`
        : ''

      const fields = []
      if (totalValue)
        fields.push({ name: 'Value', value: totalValue, inline: true })
      if (droppedValue)
        fields.push({ name: 'Loot', value: droppedValue, inline: true })

      const embed = new EmbedBuilder()
        .setColor(isLoss ? 0xfffff : 0x2b2d31)
        .setDescription(`[Open on zKillboard](${link})`)
        .setTitle(isLoss ? 'Lossmail ☠️' : 'Killmail ☠️')

      if (shipId)
        embed.setThumbnail(
          `https://images.evetech.net/types/${shipId}/render?size=128`,
        )
      if (fields.length) embed.addFields(fields)

      if (!isLoss && !isPod) await channel.send({ embeds: [embed] })
      markSeen(id)
    } catch (e) {
      if (e?.name === 'AbortError') {
        console.log('[zkill] poll timeout; retrying')
      } else {
        console.log('[zkill] loop error', e?.message || e)
      }
      await sleep(1000)
    } finally {
      await sleep(250)
    }
  }
}

const onReady = () => {
  console.log('Shall we play a game?')

  client.user.setPresence({
    status: 'online',
    activities: [
      {
        name: 'Global Thermonuclear War',
        type: ActivityType.Playing,
      },
    ],
  })

  zKillLoop()
}

client.once('clientReady', onReady)
client.login(process.env.WOPR_TOKEN || process.env.DISCORD_TOKEN)
