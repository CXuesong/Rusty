import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { ICancellationToken } from "tasklike-promise-library";
import { nextGameFrame } from "../async";
import { GameObjectRef } from "../gameObjectRef";
import { CreepMoveScheduler } from "./move";

export type TransferrableTarget =
    | StructureSpawn
    | StructureExtension
    | StructureTower
    | StructureRampart
    | StructureRoad
    | StructureWall
    | StructureContainer
    | StructureStorage
    | StructureLink;

export interface CreepTransferResourceActionOptions {
    creepRef: GameObjectRef<Creep>;
    targetRef: GameObjectRef<TransferrableTarget>;
    resourceType: ResourceConstant | "any";
}

export async function creepTransferResourceAction(options: CreepTransferResourceActionOptions, cancellationToken?: ICancellationToken): Promise<boolean> {
    const { creepRef, targetRef, resourceType } = options;
    let creep = creepRef.target!;
    let target = targetRef.target!;
    if (!creep) throw new TypeError(`Creep ${creepRef} does not exist.`);
    if (!target) throw new TypeError(`Target ${targetRef} does not exist.`);
    const logger = new Logger(`Rusty.Task.CreepActions.TransferResource.#${creep.name}+${resourceType}`);
    if (!creep.store.getUsedCapacity() || resourceType !== "any" && !creep.store[resourceType]) {
        logger.warning(`${creep} does not have enough resource (${resourceType}) to transfer.`);
        return false;
    }
    const moveScheduler = new CreepMoveScheduler(creepRef.id, targetRef.id);
    function transferResource() {
        if (resourceType === "any") {
            // transfer one kind of resource at a time.
            const resourceType = _(creep.store).entries().filter(([, v]) => v > 0).map(([k]) => k as ResourceConstant).first();
            return resourceType ? creep.transfer(target, resourceType) : ERR_NOT_ENOUGH_RESOURCES;
        }
        return creep.transfer(target, resourceType);
    }
    while (true) {
        await nextGameFrame();
        cancellationToken?.throwIfCancellationRequested();
        target = targetRef.target!;
        creep = creepRef.target!;
        if (!target || !creep) return false;
        if ("my" in target && !target.my) {
            logger.warning(`${target} is owned by ${target.owner?.username}.`);
            return false;
        }
        if (creep.store.energy <= 0) return true;
        const result = transferResource();
        logger.trace(`transferResource(${target}) -> ${result}.`);
        switch (result) {
            case OK: continue;
            case ERR_NOT_ENOUGH_RESOURCES:
                return true;
            case ERR_NOT_IN_RANGE:
                if (!moveScheduler.move()) return false;
                break;
            default:
                logger.error(`Quit transferring resource to ${target} due to error ${result}.`);
                return false;
        }
    }
}
