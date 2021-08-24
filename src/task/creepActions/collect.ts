import _ from "lodash";
import { priceSheet } from "src/market/localPriceSheet";
import { Logger } from "src/utility/logger";
import { ICancellationToken } from "tasklike-promise-library";
import { nextGameFrame } from "../async";
import { GameObjectRef } from "../gameObjectRef";
import { CreepMoveScheduler } from "./move";

export type CollectableSource = Source | Tombstone | Ruin | Resource | StructureLink | StructureStorage | Mineral | Deposit;

export interface CreepCollectActionOptions {
    creepRef: GameObjectRef<Creep>;
    sourceRef: GameObjectRef<CollectableSource>;
    resourceType: ResourceConstant | "any";
    onCollectingStarted?: () => void;
}

export async function creepCollectAction(options: CreepCollectActionOptions, cancellationToken: ICancellationToken): Promise<boolean> {
    const { creepRef, sourceRef, onCollectingStarted } = options;
    let creep = creepRef.target!;
    let source = sourceRef.target!;
    if (!creep) throw new TypeError(`Creep ${creepRef} does not exist.`);
    if (!source) throw new TypeError(`Source ${sourceRef} does not exist.`);
    const logger = new Logger(`Rusty.Task.CreepActions.Collect.#${creep.name}`);
    if (!creep.store.getFreeCapacity()) return true;
    const moveScheduler = new CreepMoveScheduler(creepRef.id, sourceRef.id);
    function collectResource() {
        if (source instanceof Source || source instanceof Mineral || source instanceof Deposit)
            return creep.harvest(source);
        if (source instanceof Resource)
            return creep.pickup(source);
        if (options.resourceType === "any") {
            // Take the most valuable one first. Take energy last.
            // Do not pick up anything other than energy from Storage.
            const resourceType = source instanceof StructureStorage
                ? RESOURCE_ENERGY
                : _(source.store)
                    .entries()
                    .filter(([, v]) => v > 0)
                    .map(([k]) => k as ResourceConstant)
                    .maxBy(k => k === RESOURCE_ENERGY ? -2 : priceSheet[k] ?? -1)!;
            return creep.withdraw(source, resourceType);
        }
        return creep.withdraw(source, options.resourceType);
    }
    let hasCollectStarted = false;
    while (true) {
        await nextGameFrame();
        cancellationToken.throwIfCancellationRequested();
        source = sourceRef.target!;
        creep = creepRef.target!;
        if (!source || !creep) return false;
        if (!creep.store.getFreeCapacity()) return true;
        const result = collectResource();
        switch (result) {
            case OK:
                if (!hasCollectStarted) {
                    hasCollectStarted = true;
                    onCollectingStarted?.();
                }
                continue;
            case ERR_FULL:
            case ERR_NOT_ENOUGH_ENERGY:
            case ERR_NOT_ENOUGH_RESOURCES:
                return true;
            case ERR_NOT_IN_RANGE:
                if (!moveScheduler.move()) return false;
                break;
            default:
                logger.error(`Quit collecting from ${source} due to error ${result}.`);
                return false;
        }

    }
}
