import { Logger } from "./utility/logger";

const logger = new Logger("Rusty.Nuke");

export function onNextFrame(room: Room): void {
    const nukes = room.find(FIND_NUKES);
    if (!nukes.length) {
        logger.trace(`No nuke in ${room.name}.`);
        return;
    }
    logger.warning(`Nuke detected in ${room.name}: ${nukes.map(n => `[${n.id}|${n.room}|${n.timeToLand}]`)}`);
    Game.notify(`${nukes.length} nuke(s) detected in ${room.name}:\n${nukes.map(n => `${n.id} from ${n.room}`)}`);
}
