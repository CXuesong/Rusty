import _ from "lodash/index";
import { ICancellationToken } from "tasklike-promise-library";
import { nextGameFrame } from "../async";
import { creepUpgradeControllerAction } from "../creepActions/upgradeController";
import type { ObjectScheduler, ScheduledCreep } from "../objectScheduler";
import { GameObjectRef, gameObjectRefFromId } from "../gameObjectRef";
import { TaskBase } from "./base";
import { Logger } from "src/utility/logger";

interface OwnedCreep {
    creepRef: GameObjectRef<Creep>;
    performTaskPromise: PromiseLike<void>;
}

export class UpgradeControllerTask extends TaskBase {
    protected readonly logger = new Logger("Rusty.Task.Definitions.UpgradeControllerTask");
    private scheduledCreeps: OwnedCreep[] = [];
    public static isApplicableToRoom(roomName: string): boolean {
        const room = Game.rooms[roomName];
        if (!room) return false;
        return room.controller?.my || false;
    }
    public constructor(private _creepScheduler: ObjectScheduler, public readonly roomName: string) {
        super();
    }
    public async doWork(cancellationToken: ICancellationToken): Promise<void> {
        while (true) {
            await nextGameFrame();
            cancellationToken.throwIfCancellationRequested();
            const room = Game.rooms[this.roomName];
            if (!room) {
                this.logger.error("Room is not penetrable.");
                return;
            }
            const { controller } = room;
            if (!controller?.my) {
                this.logger.error("No owned controller in the room.");
                return;
            }
            const livingCreeps = _(this.scheduledCreeps).filter(c => c.creepRef.exists).value();
            if (livingCreeps.length < this.scheduledCreeps.length) this.scheduledCreeps = livingCreeps;
            const expectedCreeps = 3 + controller.level;
            if (this.scheduledCreeps.length < expectedCreeps) {
                const scheduled = await this._creepScheduler.scheduleCreep({
                    sku: "CarryWorker",
                    priority: this.scheduledCreeps.length < 2 ? 5 : 3,
                    resource: RESOURCE_ENERGY,
                    preferredPositions: [
                        [controller],
                    ]
                });
                if (scheduled) {
                    this.scheduledCreeps.push({
                        creepRef: scheduled.creepRef,
                        performTaskPromise: this.creepTask(scheduled, gameObjectRefFromId(controller), cancellationToken)
                    });
                }
            }
        }
    }
    private async creepTask(scheduledCreep: ScheduledCreep, controllerRef: GameObjectRef<StructureController>, ct: ICancellationToken): Promise<void> {
        try {
            await creepUpgradeControllerAction({
                creepRef: scheduledCreep.creepRef,
                controllerRef: controllerRef,
            }, ct);
        } finally {
            scheduledCreep.dispose();
            this.scheduledCreeps.remove(scheduledCreep.creepRef);
        }
    }
}