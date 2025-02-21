# Mineflayer Mouse

First-class simple API for emulating mouse control in Mineflayer.

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
