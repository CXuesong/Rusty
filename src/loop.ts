import { tickNextGameFrame } from "./task/async";
import { loopAsync } from "./task/loop";
import { Logger } from "./utility/logger";

const logger = new Logger("Rusty.Loop");

export function onLoopStarted() {
    // Start async loop.
    loopAsync();
}

export function onNextFrame() {
    tickNextGameFrame();
    const freeTicks = Game.cpu.tickLimit - Game.cpu.getUsed();
    if (freeTicks > 0) {
        // If bucket is full, we build some pixel.
        if (Game.cpu.bucket >= PIXEL_CPU_COST) {
            Game.cpu.generatePixel();
            logger.info(`Generated 1 pixel. Total pixels: ${Game.resources[PIXEL]}.`);
        }
    }
}
