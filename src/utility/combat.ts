import { Logger } from "./logger";

const logger = new Logger("Rusty.Utility.Combat");

export function evaluateAttackPower(creep: Creep): number {
    const attackParts = creep.getActiveBodyparts(ATTACK);
    const rangedAttackParts = creep.getActiveBodyparts(RANGED_ATTACK);
    return attackParts * ATTACK_POWER + rangedAttackParts * RANGED_ATTACK_POWER;
}

export function evaluateEliminationDuration(creep: Creep, enemy: Creep): number {
    return Math.ceil(enemy.hits / evaluateAttackPower(creep));
}

export function isEliminationPossible(creep: Creep, enemy: Creep): boolean {
    const selfElmTime = evaluateEliminationDuration(enemy, creep);
    const enemyElmTime = evaluateEliminationDuration(creep, enemy);
    if (selfElmTime < enemyElmTime) {
        logger.info(`isEliminationPossible: Not possible: ${creep} -> ${enemy}. (Elimination time: ${selfElmTime} vs ${enemyElmTime})`);
        return false;
    }
    return true;
}