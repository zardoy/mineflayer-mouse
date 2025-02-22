import { Bot } from 'mineflayer'
import { BotPluginSettings, inject } from './mouse'

export const createMouse = (settings: BotPluginSettings) => {
  return (bot: Bot) => inject(bot, settings)
}
