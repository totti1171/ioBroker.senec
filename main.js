'use strict';

/*
 * Created with @iobroker/create-adapter v1.17.0
 */

const utils = require('@iobroker/adapter-core');
const request = require('request');

class Senec extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'senec',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);
        try {
            await this.checkConnection();
            await this.readSenecV21();
        } catch (error) {
            this.log.error(error);
            this.setState('info.connection', false, true);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            if (this.timer) {
                clearTimeout(this.timer);
            }
            this.log.info('cleaned everything up...');
            this.setState('info.connection', false, false);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * checks connection to senec service
     */
    async checkConnection() {
        const url = 'http://' + this.config.senecip + '/lala.cgi';
        const form = '{"STATISTIC":{"STAT_DAY_E_HOUSE":""}}';
        try {
            this.log.info('connecting to Senec: ' + this.config.senecip);
            const body = await this.doGet(url, form);
            this.log.info('connected to Senec: ' + this.config.senecip);
            this.setState('info.connection', true, true);
        } catch (error) {
            throw new Error("Error connecting to Senec (IP: " + this.config.senecip + "). Exiting! (" + error + ")");
        }
    }

    /**
     * Read from url via request
     * @param url to read from
     * @param form to post
     */
    async doGet(pUrl, pForm) {
        return new Promise(function (resolve, reject) {
            const options = {
                url: pUrl,
                method: 'POST',
                form: pForm
            };
            request(options, function (error, response, body) {
                if (error)
                    return reject(error);
                resolve(body);
            });
        });
    }

    /**
     * Read values from Senec Home V2.1
     * Leaving out Wallbox info because it won't be supplied by senec if no wallbox configured
     */
    async readSenecV21() {
        // From current senec cgi
        // '{"STATISTIC":{"STAT_DAY_E_HOUSE":"","STAT_DAY_E_PV":"","STAT_DAY_BAT_CHARGE":"","STAT_DAY_BAT_DISCHARGE":"","STAT_DAY_E_GRID_IMPORT":"","STAT_DAY_E_GRID_EXPORT":"","STAT_YEAR_E_PU1_ARR":""},"ENERGY":{"STAT_STATE":"","STAT_STATE_DECODE":"","GUI_BAT_DATA_POWER":"","GUI_INVERTER_POWER":"","GUI_HOUSE_POW":"","GUI_GRID_POW":"","STAT_MAINT_REQUIRED":"","GUI_BAT_DATA_FUEL_CHARGE":"","GUI_CHARGING_INFO":"","GUI_BOOSTING_INFO":""},"WIZARD":{"CONFIG_LOADED":""},"SYS_UPDATE":{"UPDATE_AVAILABLE":""}}'

        const url = 'http://' + this.config.senecip + '/lala.cgi';
        const form = '{"STATISTIC":{"STAT_DAY_E_HOUSE":"","STAT_DAY_E_PV":"","STAT_DAY_BAT_CHARGE":"","STAT_DAY_BAT_DISCHARGE":"","STAT_DAY_E_GRID_IMPORT":"","STAT_DAY_E_GRID_EXPORT":""},"ENERGY":{"STAT_STATE":"","GUI_BAT_DATA_POWER":"","GUI_INVERTER_POWER":"","GUI_HOUSE_POW":"","GUI_GRID_POW":"","STAT_MAINT_REQUIRED":"","GUI_BAT_DATA_FUEL_CHARGE":"","GUI_CHARGING_INFO":"","GUI_BOOSTING_INFO":""},"WIZARD":{"CONFIG_LOADED":""},"SYS_UPDATE":{"UPDATE_AVAILABLE":""}}';
        try {
            const body = await this.doGet(url, form);
            this.log.debug('received data from senec: ' + body);
            var obj = JSON.parse(body, reviverNumParse);

            // this only works, while senec sticks with format {"CAT1":{"ST1":"V1","STn":"Vn"},"CAT2":{...}...}
            for (let[key1, value1]of Object.entries(obj)) {
                for (let[key2, value2]of Object.entries(value1)) {
                    var key = key1 + '.' + key2;
                    var descUnitValue = getDescUnitValue(String(key1), String(key2), value2);
                    var desc = descUnitValue[0];
                    var unit = descUnitValue[1];
                    var value = descUnitValue[2];
                    this.doState(key, value, desc, unit);
                }
            }
            // this isn't part of the JSON but we supply it for easier reading of system-state
            var descUnitValue = getDescUnitValue("ENERGY", "STAT_STATE-Text", obj.ENERGY.STAT_STATE);
            this.doState("ENERGY.STAT_STATE_Text", descUnitValue[2], descUnitValue[0], descUnitValue[1]);

            /*
             * unknown use: ENERGY.STAT_STATE_DECODE	Ex. Value: u8_0F
             * unknown use: STATISTIC.STAT_YEAR_E_PU1_ARR is an array with just 0 values
             *
             * some have WIZARD.SETUP_NUMBER_WALLBOXES and WIZARD.SETUP_WALLBOX_SERIAL[0..3] but those don't exist on every system it appears.
             * Need to find out if this depends on wallbox configured so maybe add a switch to admin panel.
             */

            this.timer = setTimeout(() => this.readSenecV21(), this.config.interval * 1000);
        } catch (error) {
            throw new Error("Error reading from Senec (IP: " + this.config.senecip + "). Exiting! (" + error + ")");
        }
    }

    /**
     * sets a state's value and creates the state if it doesn't exist yet
     */
    async doState(name, value, description, unit) {
        await this.setObjectNotExistsAsync(name, {
            type: 'state',
            common: {
                name: description,
                type: typeof(value),
                role: 'value',
                unit: unit,
                read: true,
                write: false
            },
            native: {}
        });
        var oldState = await this.getStateAsync(name);
        if (oldState && oldState.val === value)
            return; // if value didn't change, don't update
        await this.setStateAsync(name, {
            val: value,
            ack: true
        });
    }
}

/**
 * Converts float value in hex format to js float32.
 * Also fixes to 2 decimals.
 * @param string with hex value
 */
const HexToFloat32 = (str) => {
    var int = parseInt(str, 16);
    if (int > 0 || int < 0) {
        var sign = (int >>> 31) ? -1 : 1;
        var exp = (int >>> 23 & 0xff) - 127;
        var mantissa = ((int & 0x7fffff) + 0x800000).toString(2);
        var float32 = 0;
        for (var i = 0; i < mantissa.length; i++) {
            float32 += parseInt(mantissa[i]) ? Math.pow(2, exp) : 0;
            exp--;
        }
        return (float32 * sign).toFixed(2);
    } else {
        return 0;
    }
}

/**
 * Reviver function to convert numeric values to float or int.
 * Senec supplies them as hex.
 * @param key value pair as defined in reviver option
 */
const reviverNumParse = (key, value) => {
    // prepare values for output using reviver function
    if (typeof value === "string") {
        if (value.startsWith("fl_")) { // float in hex IEEE754
            return HexToFloat32(value.substring(3));
        } else if (value.startsWith("u") || value.startsWith("u")) { // unsigned int in hex
            return parseInt(value.substring(3), 16);
        } else {
            throw new Error("Unknon value in JSON: " + key + ":" + value);
        }
    } else {
        return value;
    }
}

/**
 * Translate senec numeric system state to the official human readable representation.
 * Please report unknown values.
 * @param numeric state value
 */
const stateHumanForm = (state) => {
    // if you can supply me with the correct (senec chargon!) values in english, please open a ticket
    switch (state) {
    case 0:
        return "INITIALZUSTAND (0)";
    case 1:
        return "KEINE KOMMUNIKATION LADEGERAET (1)";
    case 2:
        return "FEHLER LEISTUNGSMESSGERAET (2)";
    case 3:
        return "RUNDSTEUEREMPFAENGER (3)";
    case 4:
        return "ERSTLADUNG (4)";
    case 5:
        return "WARTUNGSLADUNG (5)";
    case 6:
        return "WARTUNGSLADUNG FERTIG (6)";
    case 7:
        return "WARTUNG NOTWENDIG (7)";
    case 8:
        return "MAN. SICHERHEITSLADUNG (8)";
    case 9:
        return "SICHERHEITSLADUNG FERTIG (9)";
    case 10:
        return "VOLLLADUNG (10)";
    case 11:
        return "AUSGLEICHSLADUNG: LADEN (11)";
    case 12:
        return "SULFATLADUNG: LADEN (12)";
    case 13:
        return "AKKU VOLL (13)";
    case 14:
        return "LADEN (14)";
    case 15:
        return "AKKU LEER (15)";
    case 16:
        return "ENTLADEN (16)";
    case 17:
        return "PV + ENTLADEN (17)";
    case 18:
        return "NETZ + ENTLADEN (18)";
    case 19:
        return "PASSIV (19)";
    case 20:
        return "AUSGESCHALTET (20)";
    case 21:
        return "EIGENVERBRAUCH (21)";
    case 22:
        return "NEUSTART (22)";
    case 23:
        return "MAN. AUSGLEICHSLADUNG: LADEN (23)";
    case 24:
        return "MAN. SULFATLADUNG: LADEN (24)";
    case 25:
        return "SICHERHEITSLADUNG (25)";
    case 26:
        return "AKKU-SCHUTZBETRIEB (26)";
    case 27:
        return "EG FEHLER (27)";
    case 28:
        return "EG LADEN (28)";
    case 29:
        return "EG ENTLADEN (29)";
    case 30:
        return "EG PASSIV (30)";
    case 31:
        return "EG LADEN VERBOTEN (31)";
    case 32:
        return "EG ENTLADEN VERBOTEN (32)";
    case 33:
        return "NOTLADUNG (33)";
    case 34:
        return "SOFTWAREAKTUALISIERUNG (34)";
    case 35:
        return "FEHLER: NA-SCHUTZ (35)";
    case 36:
        return "FEHLER: NA-SCHUTZ NETZ (36)";
    case 37:
        return "FEHLER: NA-SCHUTZ HARDWARE (37)";
    case 38:
        return "KEINE SERVERVERBINDUNG (38)";
    case 39:
        return "BMS FEHLER (39)";
    case 40:
        return "WARTUNG: FILTER (40)";
    case 41:
        return "SCHLAFMODUS (41)";
    case 42:
        return "WARTE AUF ÜBERSCHUSS (42)";
    case 43:
        return "KAPAZITÄTSTEST: LADEN (43)";
    case 44:
        return "KAPAZITÄTSTEST: ENTLADEN (44)";
    case 45:
        return "MAN. SULFATLADUNG: WARTEN (45)";
    case 46:
        return "MAN. SULFATLADUNG: FERTIG (46)";
    case 47:
        return "MAN. SULFATLADUNG: FEHLER (47)";
    case 48:
        return "AUSGLEICHSLADUNG: WARTEN (48)";
    case 49:
        return "NOTLADUNG: FEHLER (49)";
    case 50:
        return "MAN: AUSGLEICHSLADUNG: WARTEN (50)";
    case 51:
        return "MAN: AUSGLEICHSLADUNG: FEHLER (51)";
    case 52:
        return "MAN: AUSGLEICHSLADUNG: FERTIG (52)";
    case 53:
        return "AUTO: SULFATLADUNG: WARTEN (53)";
    case 54:
        return "LADESCHLUSSPHASE (54)";
    case 55:
        return "BATTERIETRENNSCHALTER AUS (55)";
    case 56:
        return "PEAK-SHAVING: WARTEN (56)";
    case 57:
        return "FEHLER LADEGERAET (57)";
    case 58:
        return "NPU-FEHLER (58)";
    case 59:
        return "BMS OFFLINE (59)";
    case 60:
        return "WARTUNGSLADUNG FEHLER (60)";
    case 61:
        return "MAN. SICHERHEITSLADUNG FEHLER (61)";
    case 62:
        return "SICHERHEITSLADUNG FEHLER (62)";
    case 63:
        return "KEINE MASTERVERBINDUNG (63)";
    case 64:
        return "LITHIUM SICHERHEITSMODUS AKTIV (64)";
    case 65:
        return "LITHIUM SICHERHEITSMODUS BEENDET (65)";
    case 66:
        return "FEHLER BATTERIESPANNUNG (66)";
    case 67:
        return "BMS DC AUSGESCHALTET (67)";
    case 68:
        return "NETZINITIALISIERUNG (68)";
    case 69:
        return "NETZSTABILISIERUNG (69)";
    case 70:
        return "FERNABSCHALTUNG (70)";
    case 71:
        return "OFFPEAK-LADEN (71)";
    case 72:
        return "FEHLER HALBBRÜCKE (72)";
    case 73:
        return "BMS: FEHLER BETRIEBSTEMPERATUR (73)";
    case 74:
        return "FACOTRY SETTINGS NICHT GEFUNDEN (74)";
    case 75:
        return "NETZERSATZBETRIEB (75)";
    case 76:
        return "NETZERSATZBETRIEB AKKU LEER (76)";
    case 77:
        return "NETZERSATZBETRIEB FEHLER (77)";
    case 78:
        return "INITIALISIERUNG (78)";
    case 79:
        return "INSTALLATIONSMODUS (79)";
    case 80:
        return "NETZAUSFALL (80)";
    case 81:
        return "BMS UPDATE ERFORDERLICH (81)";
    case 82:
        return "BMS KONFIGURATION ERFORDERLICH (82)";
    case 83:
        return "ISOLATIONSTEST (83)";
    case 84:
        return "SELBSTTEST (84)";
    case 85:
        return "EXTERNE STEUERUNG (85)";
    default:
        return "Unknown: " + state + " (Please report to Dev)";
    }
}

/**
 * Returns the description, unit and (if needed) a modified value for a state object
 * @param the two keys per JSON, current value
 * @return [description,unit,value]
 */
const getDescUnitValue = (key1, key2, value) => {
    var w = "W";
    var kwh = "kWh";
    var pct = "%";
    switch (key1) {
    case "ENERGY":
        switch (key2) {
        case "STAT_STATE":
            return ["System Mode", "", value];
        case "STAT_STATE-Text":
            return ["System Mode", "", stateHumanForm(value)];
        case "GUI_BAT_DATA_FUEL_CHARGE":
            return ["Accu Level", pct, value];
        case "GUI_INVERTER_POWER":
            return ["PV Power current", w, value];
        case "GUI_GRID_POW":
            return ["Net Power current", w, value];
        case "GUI_BAT_DATA_POWER":
            return ["Accu Power current", w, value];
        case "GUI_HOUSE_POW":
            return ["House Power current", w, value];
        case "GUI_CHARGING_INFO":
            return ["Accu charging", "", (value === 0 ? false : true)];
        case "GUI_BOOSTING_INFO":
            return ["Boost", "", (value === 0 ? false : true)];
        case "STAT_MAINT_REQUIRED":
            return ["Maintenance required", "", (value === 0 ? false : true)];
        }

    case "STATISTIC":
        switch (key2) {
        case "STAT_DAY_E_PV":
            return ["PV Power Day", kwh, value];
        case "STAT_DAY_E_GRID_IMPORT":
            return ["Net Import Day", kwh, value];
        case "STAT_DAY_E_GRID_EXPORT":
            return ["Net Export Day", kwh, value];
        case "STAT_DAY_BAT_CHARGE":
            return ["Accu Charged Day", kwh, value];
        case "STAT_DAY_BAT_DISCHARGE":
            return ["Accu Discharged Day", kwh, value];
        case "STAT_DAY_E_HOUSE":
            return ["House Power Day", kwh, value];
        }

    case "SYS_UPDATE":
        switch (key2) {
        case "UPDATE_AVAILABLE":
            return ["Update available", "", (value === 0 ? false : true)];
        }

    case "WIZARD":
        switch (key2) {
        case "CONFIG_LOADED":
            return ["Configuration loaded", "", (value === 0 ? false : true)];
        }

    }
    return ["Unknown: " + key1 + "." + key2, "", value];
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Senec(options);
} else {
    // otherwise start the instance directly
    new Senec();
}
