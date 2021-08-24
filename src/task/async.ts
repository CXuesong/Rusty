import { Logger } from "src/utility/logger";
import { PromiseLikeResolutionSource } from "tasklike-promise-library";

const logger = new Logger("Rusty.Task.Async");

let nextFramePrs: PromiseLikeResolutionSource<number> | undefined;
let nextFramePrsTime: number | undefined;
let nextFramePrsCount = 0;
export function nextGameFrame(): PromiseLike<number> {
    const nextTick = Game.time + 1;
    if (!nextFramePrs || nextFramePrsTime == null || nextFramePrsTime < nextTick) {
        nextFramePrs?.tryResolve(Game.time);
        nextFramePrs = new PromiseLikeResolutionSource();
        nextFramePrsTime = nextTick;
        nextFramePrsCount++;
    }
    return nextFramePrs.promiseLike;
}

export function tickNextGameFrame(): void {
    if (!nextFramePrs) {
        logger.trace("tickNextGameFrame: No-op at", Game.time);
        return;
    }
    if (nextFramePrsTime != null) {
        if (Game.time > nextFramePrsTime)
            logger.warning(`tickNextGameFrame: Detected missing tickNextFrame call at ${nextFramePrsTime}. Current tick: ${Game.time}.`);
        if (Game.time < nextFramePrsTime)
            throw new Error(`Expect tickNextFrame to be called at ${nextFramePrsTime}. Current tick: ${Game.time}.`);
    }
    logger.trace("tickNextGameFrame: Resolve at", Game.time);
    console.log("resolve frame token: " + nextFramePrsCount);
    nextFramePrs.tryResolve(Game.time);
    nextFramePrs = undefined;
    nextFramePrsTime = undefined;
}
