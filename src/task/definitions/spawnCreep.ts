import _ from "lodash/index";
import { spawnCreep, trySpawn } from "src/structures/spawn";
import { Logger } from "src/utility/logger";
import { ICancellationToken } from "tasklike-promise-library";
import { nextGameFrame } from "../async";
import { CreepSku } from "../creepSku";
import type { ObjectScheduler } from "../objectScheduler";
import { TaskBase } from "./base";

export class SpawnCreepTask extends TaskBase {
    protected readonly logger = new Logger("Rusty.Task.Definitions.SpawnCreepTask");
    public static isApplicableToRoom(roomName: string): boolean {
        const room = Game.rooms[roomName];
        if (!room) return false;
        const spawns = room.find(FIND_MY_SPAWNS);
        if (!spawns.length) return false;
        return true;
    }
    public constructor(private _creepScheduler: ObjectScheduler, public readonly roomName: string) {
        super();
    }
    protected async doWork(cancellationToken: ICancellationToken): Promise<void>{
        while (true) {
            console.trace("abc");
            throw new Error("testtttttttt");
            await nextGameFrame();
            console.trace("bbbbbbbb");
            cancellationToken.throwIfCancellationRequested();
            const room = Game.rooms[this.roomName];
            if (!room) {
                this.logger.error("Room is not penetrable.");
                return;
            }
            const spawns = room.find(FIND_MY_SPAWNS);
            if (!spawns.length) {
                this.logger.error("No spawns in the room.");
                return;
            }
            const myCreeps = room.find(FIND_MY_CREEPS);
            const workerCount = _(myCreeps).filter(c => c.memory.rustySku as CreepSku === "CarryWorker").size();
            if (workerCount < 10) {
                trySpawn(spawns, s => spawnCreep(s, {
                    // 300
                    [CARRY]: 2,     // 50
                    [MOVE]: 2,      // 50
                    [WORK]: 1,      // 100
                }));
            }
        }
    }
}