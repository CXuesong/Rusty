import _ from "lodash/index";
import { Logger } from "src/utility/logger";
import { enumSpecializedCreeps, SpecializedCreepType } from "../base";
import { getRoomMemory } from "./memory";
import { estimateCollectableAmount, isCollectableFrom } from "./predicates";
import { CollectorCreepState, CollectorTargetId } from "./state";

let CollectorCreep: SpecializedCreepType<CollectorCreepState>;

let occupiedDests: Map<CollectorTargetId, Set<Id<Creep>>> | undefined;

const emptySet: ReadonlySet<any> = {
    entries: function* () { },
    forEach: () => { },
    has: () => false,
    keys: function* () { },
    size: 0,
    values: function* () { },
    [Symbol.iterator]: function* () { },
}

export function initialize(collectorCreepType: SpecializedCreepType<CollectorCreepState>): void {
    CollectorCreep = collectorCreepType;
}

export function houseKeeping(logger: Logger) {
    if (occupiedDests) {
        let count = 0;
        for (const [targetId, collectors] of occupiedDests) {
            if (!Game.getObjectById(targetId)) {
                occupiedDests.delete(targetId);
                continue;
            }
            for (const collector of collectors) {
                if (!(Game.getObjectById(collector) instanceof Creep)) {
                    collectors.delete(collector);
                }
            }
        }
        logger.info(`Removed ${count} dangling collector in occupiedDests cache.`);
    }
}

export function getTargetingCollectors(id: CollectorTargetId): ReadonlySet<Id<Creep>> {
    if (!occupiedDests) {
        occupiedDests = new Map();
        for (const c of enumSpecializedCreeps(CollectorCreep)) {
            const { operation } = c.state;
            if (operation.opName === "collect")
                addTargetingCollector(operation.targetId, c.id);
            else if (operation.opName === "distribute")
                addTargetingCollector(operation.targetId, c.id);
        }
    }
    return occupiedDests.get(id) || emptySet;
}

export function addTargetingCollector(id: CollectorTargetId, collector: Id<Creep>): void {
    if (!occupiedDests) return;
    let set = occupiedDests.get(id);
    if (!set) {
        set = new Set();
        occupiedDests.set(id, set);
    }
    set.add(collector);
}

export function removeTargetingCollector(id: CollectorTargetId, collector: Id<Creep>): void {
    if (!occupiedDests) return;
    const set = occupiedDests.get(id);
    if (!set) return;
    set.delete(collector);
    if (!set.size) occupiedDests.delete(id);
}

export function isMoreCollectorNeeded(source: Resource | Tombstone | Ruin): boolean {
    return isCollectableFrom(source)
        && (_([...getTargetingCollectors(source.id)])
            .map(id => Game.getObjectById(id))
            .sumBy(c => c?.store.getFreeCapacity() || 0)) <= 0.7 * estimateCollectableAmount(source)
}

export function onNextFrame() {
    // Track untracked (or not sufficiently-tracked) sources.
    for (const room of _(Game.rooms).values()) {
        const untargeted = [
            // ...room.find(FIND_SOURCES),
            ...room.find(FIND_DROPPED_RESOURCES),
            ...room.find(FIND_TOMBSTONES),
            ...room.find(FIND_RUINS),
        ].filter(s => isMoreCollectorNeeded(s)).map(t => t.id);
        const memory = getRoomMemory(room);
        const prevUntargeted = memory.untargetedCollectables;
        const nextUntargeted = _(untargeted).keyBy(id => id).mapValues(id => prevUntargeted[id] ?? Game.time).value();
        memory.untargetedCollectables = nextUntargeted;
    }
}
