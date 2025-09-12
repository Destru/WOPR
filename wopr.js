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

const COLOR = 0x2c2f33
const EVE_CHAR_ID = process.env.EVE_CHAR_ID || '1761654327'
const ZKILL_CHANNEL_ID = process.env.ZKILL_CHANNEL_ID || '405503298951446528'
const ZKILL_REDISQ_URL =
  process.env.ZKILL_REDISQ_URL || 'https://zkillredisq.stream/listen.php?ttw=10'

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

const ZKILL_DEBUG = process.env.ZKILL_DEBUG === '1'
const CHAR_ID = Number(EVE_CHAR_ID)

async function zKillLoop() {
  const targetId = ZKILL_DEBUG ? '845227759168782336' : ZKILL_CHANNEL_ID
  let channel = client.channels.cache.get(targetId)
  if (!channel)
    channel = await client.channels.fetch(targetId).catch(() => null)
  if (!channel) return

  const queueID = `WOPR-${client.user.id}-${Math.random().toString(36).slice(2)}`
  const base = ZKILL_REDISQ_URL.includes('queueID=')
    ? ZKILL_REDISQ_URL
    : `${ZKILL_REDISQ_URL}&queueID=${queueID}`

  for (;;) {
    try {
      const res = await fetch(base, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'WOPR (Discord Bot, zKill RedisQ)',
          Accept: 'application/json',
        },
      })
      if (!res.ok) {
        console.log(`[zkill] http ${res.status} ${res.statusText}`)
        await new Promise((r) => setTimeout(r, 2500))
        continue
      }
      const data = await res.json().catch((e) => {
        console.log('[zkill] json error', e?.message || e)
        return {}
      })
      const pkg = data?.package
      if (!pkg) {
        if (ZKILL_DEBUG) console.log('[zkill] tick (no package)')
        continue
      }
      if (ZKILL_DEBUG)
        console.log(`[zkill] package received: ${pkg.killmail?.killmail_id}`)

      const km = pkg.killmail
      const zkb = pkg.zkb || {}

      if (ZKILL_DEBUG) {
        try {
          console.log('[zkill] km keys:', Object.keys(km || {}))
          console.log(
            '[zkill] victim keys:',
            Object.keys((km && km.victim) || {}),
          )
          console.log(
            '[zkill] attackers[0] keys:',
            Object.keys((km && km.attackers && km.attackers[0]) || {}),
          )
          console.log('[zkill] zkb keys:', Object.keys(zkb || {}))
        } catch (e) {
          console.log('[zkill] debug key dump error', e?.message || e)
        }
      }

      const id = km?.killmail_id
      if (!id || seenKillmails.has(id)) continue

      const attackers = Array.isArray(km?.attackers) ? km.attackers : []
      const involved = attackers.some(
        (a) => Number(a?.character_id) === CHAR_ID,
      )
      if (!ZKILL_DEBUG && !involved) {
        if (ZKILL_DEBUG) console.log(`[zkill] skip not-mine: ${id}`)
        markSeen(id)
        continue
      }

      const shipId = km?.victim?.ship_type_id || null
      const link = `https://zkillboard.com/kill/${id}/`
      const totalValue = zkb?.totalValue
        ? `${Math.round(zkb.totalValue).toLocaleString()} ISK`
        : ''
      const droppedValue = zkb?.droppedValue
        ? `${Math.round(zkb.droppedValue).toLocaleString()} ISK`
        : ''

      const isSolo =
        attackers.length === 1 && Number(attackers[0]?.character_id) === CHAR_ID
      const title = ZKILL_DEBUG
        ? 'Debug 🛰️'
        : isSolo
          ? 'Solokill 🛰️'
          : 'Kill 🛰️'

      const fields = []
      if (totalValue)
        fields.push({ name: 'Value', value: totalValue, inline: true })
      if (droppedValue)
        fields.push({ name: 'Loot', value: droppedValue, inline: true })

      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setDescription(`[Open on zKillboard](${link})`)
        .setTitle(title)

      if (shipId)
        embed.setThumbnail(
          `https://images.evetech.net/types/${shipId}/render?size=128`,
        )
      if (fields.length) embed.addFields(fields)

      await channel.send({ embeds: [embed] })
      markSeen(id)
    } catch (e) {
      console.log('[zkill] loop error', e?.message || e)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}

const onReady = () => {
  console.log('Shall we play a game?')

  client.user.setPresence({
    status: 'online',
    activities: [
      { name: 'Global Thermonuclear War', type: ActivityType.Playing },
    ],
  })

  zKillLoop()
}

client.once('clientReady', onReady)

client.login(process.env.WOPR_TOKEN || process.env.DISCORD_TOKEN)

const http = require('http')
http
  .createServer(function (req, res) {
    res.writeHead(301, { Location: 'https://cyberpunksocial.club' })
    res.end()
  })
  .listen(8080)
