module.exports = {
/*
task manager manages haulers tasks. Task manager filters haulers in room and find jobs that need filling. Jobs are added to the que, and removed when a creep commits to a task. If a creep is doing a task and is asked for a more important task, it finishes the existing task first. Creeps have a primaryTask and a seoncdaryTask, primary task is what the creep is doing, secondary task is what the creep will do when done. when primaryTask is compelte, it becomes secondaryTask and secondary task becomes undefined.
*/
/*
task manager also manages harvesters, telling harvesters sources they may pick, then having them subtracted when a harvester chooses one
*/
    run: function taskManger(room, creepsOfRole) {
        
        //console.log(room)
        /*
        _.forEach(Object.keys(creepsOfRole["baseHauler", room.name]), function creep() {
            
            consol.log(creep)
        })
        */
        function communeBuilders() {
            
            
        }
        function remoteHarvesters() {
            
            
        }
        function harvesters() {
            
            
        }
        function haulers() {
        
        var haulersInRoom = _.filter(room.find(FIND_MY_CREEPS), function (creep) { return creep.memory.role == "baseHauler" || creep.memory.role == "containerHauler" || creep.memory.role == "generalHauler" || creep.memory.role == "hauler" })
        
        console.log(haulersInRoom)
        }
    }
};