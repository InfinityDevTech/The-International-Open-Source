import {
    cleanRoomMemory,
    createPosMap,
    customLog,
    findAdjacentCoordsToCoord,
    findAdjacentCoordsToXY,
    findClosestObject,
    findFunctionCPU,
    findLinkThroughput,
    findObjectWithID,
    forAdjacentCoords,
    forCoordsInRange,
    getRangeXY,
    getRange,
    isXYExit,
    isXYInBorder,
    isXYInRoom,
    makeRoomCoord,
    packAsNum,
    packXYAsNum,
    randomIntRange,
    randomTick,
    unpackNumAsCoord,
} from 'international/utils'
import { TerminalManager } from './terminal/terminal'
import './spawning/spawningStructures'

import './combat'
import './allyCreepRequest'
import './claimRequest'
import './combatRequest'
import {
    creepRoles,
    impassibleStructureTypesSet,
    customColors,
    remoteRoles,
    roomDimensions,
    stamps,
    defaultRoadPlanningPlainCost,
    adjacentOffsets,
    packedPosLength,
    structureTypesToProtectSet,
    buildableStructuresSet,
} from 'international/constants'
import './factory'
import { LabManager } from './labs'
import './towers'
import './links'
import { RoomVisualsManager } from '../roomVisuals'
import { EndTickCreepManager } from '../creeps/endTickCreepManager'
import { CreepRoleManager } from '../creeps/creepRoleManager'
import { RemotesManager } from './remotesManager'
import { ClaimRequestManager } from './claimRequest'
import { CombatRequestManager } from './combatRequest'
import { AllyCreepRequestManager } from './allyCreepRequest'
import { PowerSpawningStructuresManager } from './powerSpawn'
import './haulerSize'
import { SourceManager } from './sourceManager'
import { TowerManager } from './towers'
import { CombatManager } from './combat'
import { SpawningStructuresManager } from './spawning/spawningStructures'
import { HaulRequestManager } from './haulRequestManager'
import { HaulerSizeManager } from './haulerSize'
import { HaulerNeedManager } from './haulerNeed'
import { packCoord, packXYAsCoord, unpackCoord, unpackPosList, unpackStampAnchors } from 'other/codec'
import { ContainerManager } from '../container'
import { StoringStructuresManager } from './storingStructures'
import { DroppedResourceManager } from 'room/droppedResources'
import { LinkManager } from './links'
import { profiler } from 'other/profiler'
import { FactoryManager } from './factory'
import { SpawnRequestsManager } from './spawning/spawnRequests'
import { ObserverManager } from './observer'
import { encode } from 'base32768'
import { BasePlans } from '../construction/basePlans'
import { internationalManager } from 'international/international'
import { ConstructionManager } from 'room/construction/construction'
import { RampartPlans } from 'room/construction/rampartPlans'
import { has } from 'lodash'

export class CommuneManager {
    // Managers
    constructionManager: ConstructionManager
    combatManager: CombatManager

    towerManager: TowerManager
    storingStructuresManager: StoringStructuresManager
    linkManager: LinkManager
    labManager: LabManager
    powerSpawningStructuresManager: PowerSpawningStructuresManager
    spawnRequestsManager: SpawnRequestsManager
    spawningStructuresManager: SpawningStructuresManager
    sourceManager: SourceManager

    observerManager: ObserverManager
    terminalManager: TerminalManager
    remotesManager: RemotesManager
    haulerSizeManager: HaulerSizeManager

    claimRequestManager: ClaimRequestManager
    combatRequestManager: CombatRequestManager
    allyCreepRequestManager: AllyCreepRequestManager
    haulRequestManager: HaulRequestManager
    haulerNeedManager: HaulerNeedManager

    factoryManager: FactoryManager

    //

    room: Room
    nextSpawnEnergyAvailable: number
    estimatedEnergyIncome: number

    constructor() {
        this.constructionManager = new ConstructionManager(this)
        this.combatManager = new CombatManager(this)

        this.towerManager = new TowerManager(this)
        this.storingStructuresManager = new StoringStructuresManager(this)
        this.linkManager = new LinkManager(this)
        this.labManager = new LabManager(this)
        this.powerSpawningStructuresManager = new PowerSpawningStructuresManager(this)
        this.spawnRequestsManager = new SpawnRequestsManager(this)
        this.spawningStructuresManager = new SpawningStructuresManager(this)
        this.sourceManager = new SourceManager(this)

        this.observerManager = new ObserverManager(this)
        this.terminalManager = new TerminalManager(this)
        this[RoomMemoryKeys.remotes]Manager = new RemotesManager(this)
        this.haulerSizeManager = new HaulerSizeManager(this)

        this.claimRequestManager = new ClaimRequestManager(this)
        this.combatRequestManager = new CombatRequestManager(this)
        this.allyCreepRequestManager = new AllyCreepRequestManager(this)
        this.haulRequestManager = new HaulRequestManager(this)
        this.haulerNeedManager = new HaulerNeedManager(this)

        this.factoryManager = new FactoryManager(this)
    }

    public update(room: Room) {
        delete this._minStoredEnergy
        delete this._storingStructures
        delete this._maxCombatRequests
        delete this._rampartRepairTargets
        delete this._defensiveRamparts

        if (randomTick()) {
            delete this._maxUpgradeStrength
            delete this._minRampartHits
            delete this._upgradeStructure
        }

        this.room = room
        const roomMemory = Memory.rooms[room.name]

        // If we should abandon the room

        if (room.memory[RoomMemoryKeys.abandoned]) {
            room.controller.unclaim()
            roomMemory.T = 'neutral'
            cleanRoomMemory(room.name)

            for (const cSite of room.find(FIND_MY_CONSTRUCTION_SITES)) {
                cSite.remove()
            }
            return
        }

        room.memory.T = 'commune'
        global.communes.add(room.name)
        this.preTickTest()

        if (!roomMemory[RoomMemoryKeys.greatestRCL]) {
            if (global.communes.size <= 1) roomMemory[RoomMemoryKeys.greatestRCL] = room.controller.level
            else if (room.controller.progress > room.controller.progressTotal || room.find(FIND_MY_STRUCTURES).length) {
                roomMemory[RoomMemoryKeys.greatestRCL] = 8
            } else roomMemory[RoomMemoryKeys.greatestRCL] = room.controller.level
        } else if (room.controller.level > roomMemory[RoomMemoryKeys.greatestRCL]) roomMemory[RoomMemoryKeys.greatestRCL] = room.controller.level

        if (!room.memory.combatRequests) room.memory.combatRequests = []
        if (!room.memory.haulRequests) room.memory.haulRequests = []

        room.spawnRequestsArgs = []
        room.upgradeStrength = 0
        room.mineralHarvestStrength = 0
        room.roomLogisticsRequests = {
            transfer: {},
            withdraw: {},
            offer: {},
            pickup: {},
        }
        room.haulerNeed = 0
        this.nextSpawnEnergyAvailable = room.energyAvailable
        this.estimatedEnergyIncome = 0

        if (!room.memory[RoomMemoryKeys.remotes]) room.memory[RoomMemoryKeys.remotes] = []
        if (roomMemory[RoomMemoryKeys.threatened] == undefined) roomMemory[RoomMemoryKeys.threatened] = 0

        room.usedRampartIDs = new Map()

        room.creepsOfRemote = {}

        for (let index = room.memory[RoomMemoryKeys.remotes].length - 1; index >= 0; index -= 1) {
            const remoteName = room.memory[RoomMemoryKeys.remotes][index]
            room.creepsOfRemote[remoteName] = {}
            for (const role of remoteRoles) room.creepsOfRemote[remoteName][role] = []
        }

        // For each role, construct an array for creepsFromRoom

        room.creepsFromRoom = {}
        for (const role of creepRoles) room.creepsFromRoom[role] = []

        room.creepsFromRoomAmount = 0

        room.scoutTargets = new Set()

        if (!room.memory[RoomMemoryKeys.deposits]) room.memory[RoomMemoryKeys.deposits] = {}

        room.attackingDefenderIDs = new Set()
        room.defenderEnemyTargetsWithDamage = new Map()
        room.defenderEnemyTargetsWithDefender = new Map()

        if (room.terminal && room.controller.level >= 6) internationalManager.terminalCommunes.push(room.name)
    }

    preTickRun() {
        const roomMemory = Memory.rooms[this.room.name]

        this.room.roomManager.communePlanner.preTickRun()
        if (!roomMemory[RoomMemoryKeys.planningCompleted]) return
        this.constructionManager.preTickRun()
        this.observerManager.preTickRun()
        this.terminalManager.preTickRun()
        this[RoomMemoryKeys.remotes]Manager.preTickRun()
        this.haulRequestManager.preTickRun()
        this.sourceManager.preTickRun()
        this.claimRequestManager.preTickRun()
    }

    public run() {
        if (!this.room.memory[RoomMemoryKeys.planningCompleted]) return

        this.combatManager.run()
        this.towerManager.run()
        this.combatManager.manageThreat()
        this.combatManager.manageDefenceRequests()

        this.terminalManager.run()

        this.claimRequestManager.run()
        this.combatRequestManager.run()
        this.allyCreepRequestManager.run()
        this.haulRequestManager.run()

        this.sourceManager.run()
        this[RoomMemoryKeys.remotes]Manager.run()
        this.haulerNeedManager.run()

        this.spawningStructuresManager.createRoomLogisticsRequests()
        this.storingStructuresManager.run()
        this.factoryManager.run()
        this.room.roomManager.containerManager.runCommune()
        this.room.roomManager.droppedResourceManager.runCommune()
        this.room.roomManager.tombstoneManager.runCommune()
        this.room.roomManager.ruinManager.runCommune()
        this.linkManager.run()
        this.labManager.run()
        this.powerSpawningStructuresManager.run()
        this.spawningStructuresManager.organizeSpawns()
        this.spawningStructuresManager.createPowerTasks()

        this.room.roomManager.creepRoleManager.run()
        this.room.roomManager.powerCreepRoleManager.run()

        this.haulerSizeManager.run()
        this.spawningStructuresManager.run()

        this.room.roomManager.endTickCreepManager.run()
        this.room.roomManager.roomVisualsManager.run()

        this.test()
    }

    private preTickTest() {
        return

        let CPUUsed = Game.cpu.getUsed()

        customLog('CPU TEST 1 ' + this.room.name, Game.cpu.getUsed() - CPUUsed, {
            bgColor: customColors.red,
            textColor: customColors.white,
        })
    }

    private test() {
        /* this.room.visualizeCostMatrix(this.room.defaultCostMatrix) */

        /*
        const array = new Array(2500)

        for (let i = 0; i < array.length; i++) {
            array[i] = packBasePlanCoord(STRUCTURE_SPAWN, 1)
        }
        */

        return

        let CPUUsed = Game.cpu.getUsed()

        customLog('CPU TEST 1 ' + this.room.name, Game.cpu.getUsed() - CPUUsed, {
            bgColor: customColors.red,
            textColor: customColors.white,
        })
    }

    public deleteCombatRequest(requestName: string, index: number) {
        delete Memory.combatRequests[requestName]
        this.room.memory.combatRequests.splice(index, 1)
    }

    public removeRemote(remoteName: string, index: number) {
        this.room.memory[RoomMemoryKeys.remotes].splice(index, 1)

        const remoteMemory = Memory.rooms[remoteName]

        remoteMemory.T = 'neutral'
        cleanRoomMemory(remoteName)
    }

    public findMinRangedAttackCost(minDamage: number = 10) {
        const rawCost =
            (minDamage / RANGED_ATTACK_POWER) * BODYPART_COST[RANGED_ATTACK] +
            (minDamage / RANGED_ATTACK_POWER) * BODYPART_COST[MOVE]
        const combinedCost = BODYPART_COST[RANGED_ATTACK] + BODYPART_COST[MOVE]

        return Math.ceil(rawCost / combinedCost) * combinedCost
    }

    public findMinMeleeAttackCost(minDamage: number = 30) {
        const rawCost =
            (minDamage / ATTACK_POWER) * BODYPART_COST[ATTACK] + (minDamage / ATTACK_POWER) * BODYPART_COST[MOVE]
        const combinedCost = BODYPART_COST[ATTACK] + BODYPART_COST[MOVE]

        return Math.ceil(rawCost / combinedCost) * combinedCost
    }

    /**
     * Finds how expensive it will be to provide enough heal parts to withstand attacks
     */
    public findMinHealCost(minHeal: number = 12) {
        const rawCost = (minHeal / HEAL_POWER) * BODYPART_COST[HEAL] + (minHeal / HEAL_POWER) * BODYPART_COST[MOVE]
        const combinedCost = BODYPART_COST[HEAL] + BODYPART_COST[MOVE]

        return Math.ceil(rawCost / combinedCost) * combinedCost
    }

    public findMinDismantleCost(minDismantle: number = 0) {
        const rawCost = minDismantle * BODYPART_COST[WORK] + minDismantle * BODYPART_COST[MOVE]
        const combinedCost = BODYPART_COST[WORK] + BODYPART_COST[MOVE]

        return Math.ceil(rawCost / combinedCost) * combinedCost
    }

    _minStoredEnergy: number

    /**
     * The minimum amount of stored energy the room should only use in emergencies
     */
    get minStoredEnergy() {
        if (this._minStoredEnergy !== undefined) return this._minStoredEnergy

        // Consider the controller level to an exponent and this room's attack threat

        this._minStoredEnergy = Math.pow(this.room.controller.level * 6000, 1.06) + this.room.memory[RoomMemoryKeys.threatened] * 20

        // If there is a next RCL, Take away some minimum based on how close we are to the next RCL

        const RClCost = this.room.controller.progressTotal
        if (RClCost) {
            this._minStoredEnergy -= Math.pow((Math.min(this.room.controller.progress, RClCost) / RClCost) * 20, 3.35)
        }
        return (this._minStoredEnergy = Math.floor(this._minStoredEnergy))
    }

    get storedEnergyUpgradeThreshold() {
        return this.minStoredEnergy * 1.3
    }

    get storedEnergyBuildThreshold() {
        return this.minStoredEnergy * 1.2
    }

    _minRampartHits: number

    get minRampartHits() {
        if (this._minRampartHits !== undefined) return this._minRampartHits

        const level = this.room.controller.level

        return (this._minRampartHits =
            Math.min(
                Math.floor(Math.pow((level - 3) * 50, 2.5) + this.room.memory[RoomMemoryKeys.threatened] * 5 * Math.pow(level, 2)),
                RAMPART_HITS_MAX[level] * 0.9,
            ) || 20000)
    }

    _storingStructures: (StructureStorage | StructureTerminal)[]

    get storingStructures() {
        if (this._storingStructures) return this._storingStructures

        this._storingStructures = []

        if (this.room.storage) this._storingStructures.push(this.room.storage)
        if (this.room.terminal) this._storingStructures.push(this.room.terminal)

        return this._storingStructures
    }

    get storingStructuresCapacity() {
        let capacity = 0
        if (this.room.storage) capacity += this.room.storage.store.getCapacity()
        if (this.room.terminal) capacity += this.room.terminal.store.getCapacity()
        return capacity
    }

    _maxCombatRequests: number

    /**
     * The largest amount of combat requests the room can respond to
     */
    get maxCombatRequests() {
        if (this._maxCombatRequests !== undefined) return this._maxCombatRequests

        /* return (this._maxCombatRequests =
            (this.room.resourcesInStoringStructures.energy - this.minStoredEnergy) /
            (5000 + this.room.controller.level * 1000)) */
        return (this._maxCombatRequests =
            this.room.resourcesInStoringStructures.energy / (10000 + this.room.controller.level * 3000))
    }

    /**
     * Wether builders should ask for resources instead of seeking them out themselves
     */
    get buildersMakeRequests() {
        // Only set true if there are no viable storing structures

        return (
            !this.room.fastFillerContainerLeft &&
            !this.room.fastFillerContainerRight &&
            !this.room.storage &&
            !this.room.terminal
        )
    }

    _maxUpgradeStrength: number
    get maxUpgradeStrength() {
        if (this._maxUpgradeStrength !== undefined) return this._maxUpgradeStrength

        const upgradeStructure = this.upgradeStructure
        if (!upgradeStructure) return this.findNudeMaxUpgradeStrength()

        // Container

        if (upgradeStructure.structureType === STRUCTURE_CONTAINER) {
            return (this._maxUpgradeStrength =
                upgradeStructure.store.getCapacity() / (4 + this.room.memory[RoomMemoryKeys.upgradePath].length / packedPosLength))
        }

        // Link

        const hubLink = this.room.hubLink
        const sourceLinks = this.room.sourceLinks

        // If there are transfer links, max out partMultiplier to their ability

        this._maxUpgradeStrength = 0

        if (hubLink && hubLink.RCLActionable) {
            const range = getRange(upgradeStructure.pos, hubLink.pos)

            // Increase strength by throughput

            this._maxUpgradeStrength += findLinkThroughput(range) * 0.7
        }

        for (let i = 0; i < sourceLinks.length; i++) {
            const sourceLink = sourceLinks[i]

            if (!sourceLink.RCLActionable) continue

            const range = getRange(sourceLink.pos, upgradeStructure.pos)

            // Increase strength by throughput

            this._maxUpgradeStrength += findLinkThroughput(range, this.room.estimatedSourceIncome[i]) * 0.7
        }

        return this._maxUpgradeStrength
    }

    /**
     * The max upgrade strength when we have no local storing structure
     */
    findNudeMaxUpgradeStrength() {
        return (this._maxUpgradeStrength = 100)
    }

    _upgradeStructure: AnyStoreStructure | false
    get upgradeStructure() {
        if (this._upgradeStructure !== undefined) return this._upgradeStructure

        // We can't use a structure

        const controllerLevel = this.room.controller.level
        if (controllerLevel < 2) return (this._upgradeStructure = false)

        // We can use containers

        if (controllerLevel < 5) {
            return (this._upgradeStructure = this.room.controllerContainer)
        }

        // We can use links

        const controllerLink = this.room.controllerLink
        if (!controllerLink || !controllerLink.RCLActionable) return false

        const hubLink = this.room.hubLink
        if (!hubLink || !hubLink.RCLActionable) return false

        return (this._upgradeStructure = controllerLink)
    }

    _structureTypesByBuildPriority: BuildableStructureConstant[]
    get structureTypesByBuildPriority() {
        if (this._structureTypesByBuildPriority) return this._structureTypesByBuildPriority

        if (!this.room.fastFillerContainerLeft && !this.room.fastFillerContainerRight) {
            return (this._structureTypesByBuildPriority = [
                STRUCTURE_RAMPART,
                STRUCTURE_WALL,
                STRUCTURE_SPAWN,
                STRUCTURE_CONTAINER,
                STRUCTURE_EXTENSION,
                STRUCTURE_ROAD,
                STRUCTURE_STORAGE,
                STRUCTURE_TOWER,
                STRUCTURE_TERMINAL,
                STRUCTURE_LINK,
                STRUCTURE_EXTRACTOR,
                STRUCTURE_LAB,
                STRUCTURE_FACTORY,
                STRUCTURE_POWER_SPAWN,
                STRUCTURE_NUKER,
                STRUCTURE_OBSERVER,
            ])
        }

        this._structureTypesByBuildPriority = [
            STRUCTURE_RAMPART,
            STRUCTURE_WALL,
            STRUCTURE_SPAWN,
            STRUCTURE_EXTENSION,
            STRUCTURE_CONTAINER,
            STRUCTURE_ROAD,
            STRUCTURE_STORAGE,
            STRUCTURE_TOWER,
            STRUCTURE_TERMINAL,
            STRUCTURE_LINK,
            STRUCTURE_EXTRACTOR,
            STRUCTURE_LAB,
            STRUCTURE_FACTORY,
            STRUCTURE_POWER_SPAWN,
            STRUCTURE_NUKER,
            STRUCTURE_OBSERVER,
        ]

        return this._structureTypesByBuildPriority
    }

    /**
     * When the room needs to upgrade at high priority to remove the downgrade timer
     */
    get controllerDowngradeUpgradeThreshold() {
        return Math.floor(CONTROLLER_DOWNGRADE[this.room.controller.level] * 0.75)
    }

    _defensiveRamparts: StructureRampart[]
    get defensiveRamparts() {
        if (this._defensiveRamparts) return this._defensiveRamparts

        const ramparts: StructureRampart[] = []

        const stampAnchors = this.room.roomManager.stampAnchors
        if (!stampAnchors) throw Error('No stampAnchors for defensive ramparts')

        const minCutCoords = new Set(stampAnchors.minCutRampart.map(coord => packCoord(coord)))

        for (const structure of this.room.structures.rampart) {
            if (!minCutCoords.has(packCoord(structure.pos))) continue

            ramparts.push(structure)
        }

        return (this._defensiveRamparts = ramparts)
    }

    get minThreatRampartsThreshold() {
        return 20000
    }

    _rampartRepairTargets: StructureRampart[]
    get rampartRepairTargets() {
        const rampartRepairTargets: StructureRampart[] = []
        const rampartPlans = RampartPlans.unpack(this.room.memory[RoomMemoryKeys.rampartPlans])

        for (const structure of this.room.structures.rampart) {
            const data = rampartPlans.map[packCoord(structure.pos)]
            if (!data) continue

            if (data.minRCL > this.room.controller.level) continue
            if (data.coversStructure && !this.room.coordHasStructureTypes(structure.pos, structureTypesToProtectSet))
                continue

            if (data.buildForNuke) {
                if (!this.room.roomManager.nukeTargetCoords[packAsNum(structure.pos)]) continue

                rampartRepairTargets.push(structure)
            } else if (data.buildForThreat) {
                if (Memory.rooms[this.room.name][RoomMemoryKeys.threatened] < this.minThreatRampartsThreshold) continue
                rampartRepairTargets.push(structure)
            }

            rampartRepairTargets.push(structure)
        }

        return (this._rampartRepairTargets = rampartRepairTargets)
    }
}
