# <img src="assets/mouse.svg" width="28" height="28" alt="mineflayer-mouse"> Mineflayer Mouse

First-class **battle-tested** simple API for emulating real Minecraft mouse control in Mineflayer. You should use it for digging (mining) or placing blocks and entity attacking or using and using items!

> Note: This module will be deprecated once the functionality is merged into the main `mineflayer` library with 1:1 implementation.

## Installation

```bash
pnpm add mineflayer-mouse
```

## Features

- Predict block placement (optimistic update, needed for correct physics on high ping)
- Block breaking server cancellation
- Accurate entity raycasting (targeting)
- Debug logging

## Philosophy

> Note: this library is used in [minecraft web client](http://github.com/zardoy/prismarine-web-client/) project. Try mineflayer viewer lib: [mcraft-fun-mineflayer](https://npmjs.com/mcraft-fun-mineflayer) to see it in action!

The world interaction system in Minecraft is *complex* and not easy to replicate. We have two hands and different holding item/blocks logic along with different entities and activatable items and blocks in the world. For example:

- Would what happen if you right click on a crafting table with a torch in left hand and potion in right hand? But if you are shift clicking it? But if you are loooking at entity? Should the item be used or entity interaction happen?

Using hardcoded methods like `bot.attack` will make your bot act not natural and more likely would result in ban.

## Usage

```ts
import { createMouse } from 'mineflayer-mouse';
import { createBot } from 'mineflayer';

const bot = createBot({
  host: 'localhost',
  port: 25565,
});

bot.loadPlugin(createMouse());

// based on returned entity or block you can determine what action would happen (you cant enfoce specific action since thats not how game works)
const { entity, cursorBlock, cursorBlockDiggable } = bot.mouse.getCursorState();

// attack entity
bot.leftClick();
// start digging block
bot.leftClickStart()
// stop digging block
bot.leftClickEnd()

// place block
bot.rightClick()

// start placing block
bot.rightClickStart()

// ...
```

## Roadmap

- [X] Tests
- [X] Block placement prediction
- [X] Raycast, item/block activatable, block prediction overrides
- [X] Better item activation
- [ ] Arm animation & use item on block place check world env
- [ ] Validate packets on item activation on entity
