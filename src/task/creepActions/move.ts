import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { findPathTo } from "src/utility/pathFinder";
import { GameObjectRef, gameObjectRefFromId } from "../gameObjectRef";

export class CreepMoveScheduler {
    private readonly logger: Logger;
    private path: RoomPosition[] | undefined;
    private nextPathSchedule = -1;
    private stuckSince: number | undefined;
    private readonly creepRef: GameObjectRef<Creep>;
    private readonly targetRef: GameObjectRef<RoomObject>;
    public constructor(creepId: Id<Creep>, targetId: Id<RoomObject>) {
        this.creepRef = gameObjectRefFromId(creepId);
        this.targetRef = gameObjectRefFromId(targetId);
        this.logger = new Logger(`Rusty.Task.CreepActions.CreepMover.#${this.creepRef}`);
    }
    private schedulePath(): void {
        const result = findPathTo(this.creepRef.target!, this.targetRef.target!.pos, { maxRooms: 1 });
        if (result) {
            this.nextPathSchedule = Game.time + _.random(5, 10);
            this.path = result.path;
            this.stuckSince = undefined;
        } else {
            this.nextPathSchedule = Game.time + _.random(1, 3);
            this.path = undefined;
            this.stuckSince ??= Game.time;
        }
    }
    public move(): boolean {
        const creep = this.creepRef.target;
        const target = this.targetRef.target;
        if (!target || !creep) return false;
        if (this.nextPathSchedule < 0 || Game.time >= this.nextPathSchedule) {
            this.schedulePath();
        }
        if (this.path) {
            creep.moveByPath(this.path);
            return true;
        }
        if (this.stuckSince != null && Game.time - this.stuckSince > 50) {
            this.logger.warning(`${creep} is stuck for too long.`);
            return false;
        }
        return true;
    }
}