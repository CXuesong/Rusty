export type GameMode = "world" | "sim";

let gameModeCache: GameMode | undefined;
export function getGameMode(): GameMode {
    if (!gameModeCache) {
        if (Game.rooms.sim && Game.cpu.getUsed() < 0.01)
            gameModeCache = "sim";
        else
            gameModeCache = "world";
    }
    return gameModeCache;
}
