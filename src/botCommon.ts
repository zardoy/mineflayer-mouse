import { Bot } from 'mineflayer'

export const getBotEyeHeight = (bot: Bot) => {
    // todo use bot.entity.eyeHeight when its not broken
    return bot.controlState.sneak ? 1.27 : 1.62
}
