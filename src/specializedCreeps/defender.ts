import _ from "lodash/index";
import { evaluateAttackPower, isEliminationPossible } from "src/utility/combat";
import { Logger } from "src/utility/logger";
import { SpecializedCreepBase, SpecializedSpawnCreepErrorCode } from "./base";
import { initializeCreepMemory, spawnCreep } from "./spawn";

export interface DefenderCreepState {
    spawnId?: Id<StructureSpawn>;
    targetId?: Id<Creep>;
}

export class DefenderCreep extends SpecializedCreepBase<DefenderCreepState> {
    public static readonly rustyType = "defender";
    private logger = new Logger(`Rusty.SpecializedCreeps.DefenderCreep.#${this.creep.name}`);
    private readonly myAttackPower: number;
    public static spawn(spawn: StructureSpawn): string | SpecializedSpawnCreepErrorCode {
        const name = spawnCreep(spawn, {
            [RANGED_ATTACK]: 1,
            [MOVE]: 3,
        });
        if (typeof name === "string") {
            initializeCreepMemory<DefenderCreepState>(name, DefenderCreep.rustyType, {});
        }
        return name;
    }
    public constructor(public id: Id<Creep>) {
        super(id);
        this.myAttackPower = evaluateAttackPower(this.creep);
    }
    public nextFrame(): void {
        const { creep, state } = this;
        let spawn = state.spawnId && Game.getObjectById(state.spawnId);
        if (!spawn) {
            spawn = _(creep.room.find(FIND_MY_SPAWNS)).sample()
                || creep.pos.findClosestByPath(FIND_MY_SPAWNS)
                || _(Game.spawns).values().sample();
            if (!spawn) {
                this.logger.warning("No spawn available.");
                return;
            }
            state.spawnId = spawn.id;
        }
        let target = state.targetId && Game.getObjectById(state.targetId);
        if (!target) {
            const { room } = creep;
            if (room !== spawn.room) {
                creep.moveTo(spawn);
                return;
            }
            // Select target
            const hostile = room.find(FIND_HOSTILE_CREEPS);
            target = hostile.find(h => isEliminationPossible(creep, h));
            state.targetId = target?.id;
            if (target) {
                this.logger.warning(`Target locked: ${target}.`);
            }
        }
        // if (creep.hits < Math.max(100, creep.hitsMax * 0.9)) {
        //     creep.heal(creep);
        // }
        if (target) {
            let result;
            switch (0) {
                case 0:
                    result = creep.rangedAttack(target);
                    this.logger.info(`creep.rangedAttack(${target}) -> ${result}`);
                    break;
                default:
                    result = creep.rangedMassAttack();
                    creep.moveTo(target);
                    this.logger.info(`creep.rangedMassAttack(${target}) -> ${result}`);
                    break;
            }
            switch (result) {
                case ERR_NOT_IN_RANGE:
                    creep.moveTo(target);
                    break;
            }
        }
    }
}
