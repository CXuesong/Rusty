import { Logger } from "src/utility/logger";
import { ICancellationToken } from "tasklike-promise-library";
import { nextGameFrame } from "../async";
import { GameObjectRef } from "../gameObjectRef";
import { CreepMoveScheduler } from "./move";

export const MIN_UPGRADE_CONTROLLER_ENERGY = 10;

export interface CreepUpgradeControllerActionOptions {
    creepRef: GameObjectRef<Creep>;
    controllerRef: GameObjectRef<StructureController>;
}

export async function creepUpgradeControllerAction(options: CreepUpgradeControllerActionOptions, cancellationToken?: ICancellationToken): Promise<boolean> {
    const { creepRef, controllerRef } = options;
    let creep = creepRef.target!;
    let controller = controllerRef.target!;
    if (!creep) throw new TypeError(`Creep ${creepRef} does not exist.`);
    if (!controller) throw new TypeError(`Controller ${controllerRef} does not exist.`);
    const logger = new Logger(`Rusty.Task.CreepActions.UpgradeController.#${creep.name}`);
    if (creep.store.energy < MIN_UPGRADE_CONTROLLER_ENERGY) {
        logger.warning(`${creep} does not have enough energy to upgrade controller.`);
    }
    const moveScheduler = new CreepMoveScheduler(creepRef.id, controllerRef.id);
    while (true) {
        await nextGameFrame();
        cancellationToken?.throwIfCancellationRequested();
        controller = controllerRef.target!;
        creep = creepRef.target!;
        if (!controller || !creep) return false;
        if (!controller.my) {
            logger.warning(`${controller} is owned by ${controller.owner?.username}.`);
            return false;
        }
        if (creep.store.energy <= 0) return true;
        const result = creep.upgradeController(controller);
        switch (result) {
            case OK: continue;
            case ERR_NOT_ENOUGH_ENERGY:
                return true;
            case ERR_NOT_IN_RANGE:
                if (!moveScheduler.move()) return false;
                break;
            default:
                logger.error(`Quit upgrading ${controller} due to error ${result}.`);
                return false;
        }
    }
}
