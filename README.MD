# Mineflayer Mouse

First-class **battle-tested** simple API for emulating real Minecraft mouse control in Mineflayer. You should use it for digging (mining) or placing blocks and entity attacking or using and using items.

> Note: This module will be deprecated once the functionality is merged into the main `mineflayer` library with 1:1.

## Installation

```bash
pnpm add mineflayer-mouse
```

## Usage

```ts
import { createMouse } from 'mineflayer-mouse';
import { createBot } from 'mineflayer';

const bot = createBot({
  host: 'localhost',
  port: 25565,
});

bot.loadPlugin(createMouse());

bot.mouse.leftClick();

bot.mouse.rightClick();

bot.mouse.scroll(10);


```
