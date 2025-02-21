import { Bot } from 'mineflayer'
import { inject } from './mouse'

export const createMouse = (bot: Bot) => {
  return inject(bot)
}
