# Virtual Smart Thermostat voor Homebridge

Werkt met **Homebridge 1.8+ en 2.x**.

Virtuele HomeKit-thermostaat. Je kiest zelf welke thermometer de huidige temperatuur levert, bijvoorbeeld een **Shelly H&T**.

## Temperatuurbron kiezen

Vul bij elke thermostaat **Thermometer** in met de naam zoals die in Apple Home / Homebridge staat:

```text
Shelly H&T
```

of de kamernaam van de sensor, bijvoorbeeld `Woonkamer`.

Bij het starten schrijft de plugin in de log welke sensors hij ziet:

```text
Beschikbare temperatuursensors: Shelly H&T, HomePod mini
```

Kopieer die naam exact.

### Shelly alleen in Apple Home

Apple Home laat een plugin niet vrij een willekeurige HomeKit-sensor kiezen. Als de Shelly **alleen** via Matter/HomeKit in Apple Home staat en niet via een Homebridge-plugin, vul dan het lokale IP in:

```json
"shellyHost": "192.168.1.50"
```

De plugin leest dan rechtstreeks de thermometer (gen1 en gen2/Plus).

### Shelly Uni (gen1, DS18B20)

Shelly Uni heeft geen ingebouwde kamerthermometer. De 1-Wire probes staan in `/status` onder `ext_temperature`. Zonder `shellySensor` wordt de eerste geldige probe gebruikt. Kies `0` of `1` als er twee thermometers op de Uni zitten:

```json
"shellyHost": "192.168.1.40",
"shellySensor": "0"
```

Ongeldige probes (`999` of leeg) worden overgeslagen. Een DHT22 op de Uni levert ook luchtvochtigheid.

### Shelly Add-on (Plus 1 / Plus 1PM / Plus 2PM)

De Shelly Plus Add-on (DS18B20 of DHT22) verschijnt als `temperature:100`, `temperature:101`, … De chiptemperatuur van het relais (`switch:0`) wordt niet gebruikt, die is te warm. Zonder `shellySensor` pakt de plugin de eerste Add-on-probe. Meerdere probes:

```json
"shellyHost": "192.168.1.41",
"shellySensor": "100"
```

`addon` of `external` dwingt een externe probe. `internal` leest alleen de apparaattemperatuur (niet aan te raden voor een kamerthermostaat). Optioneel `shellyUser` / `shellyPassword` (basic of digest).

### Volgorde

1. `shellyHost` als die is ingevuld
2. Anders `temperatureUrl`
3. Anders `temperatureSensor` (Homebridge-cache, of IP als je daar een adres invult)
4. Anders webhook naar poort 18081

Vochtigheid van een Shelly H&T wordt ook op de thermostaat getoond.

## Configuratie

```json
{
  "platform": "VirtualSmartThermostat",
  "name": "Virtual Smart Thermostat",
  "pollInterval": 60,
  "webhookPort": 18081,
  "thermostats": [
    {
      "id": "woonkamer",
      "name": "Woonkamer thermostaat",
      "temperatureSensor": "Shelly H&T",
      "shellyHost": "192.168.1.40",
      "shellySensor": "0",
      "defaultTarget": 20,
      "hysteresis": 0.5,
      "minOnSeconds": 90,
      "minOffSeconds": 90,
      "showHeaterSwitch": false,
      "appliances": [
        {
          "name": "Ketel",
          "type": "heater",
          "controlType": "webhook",
          "webhook": "http://192.168.1.50/api/heater"
        }
      ]
    }
  ]
}
```

## Installeren

Kopieer de map naar:

```text
/var/lib/homebridge/node_modules/homebridge-virtual-smart-thermostat
```

of in Docker:

```text
/homebridge/node_modules/homebridge-virtual-smart-thermostat
```

Herstart Homebridge. Verwijder `homebridge-smart-thermostat-control`.

## Automations in Apple Home of Eve

Er is altijd een sensor **Woonkamer thermostaat heat** (occupancy):

- aanwezig = **heat on**
- niet aanwezig = **heat off**

In Eve of de Woning-app:

1. Als `heat` aanwezig is → echte stekker/ketel aan
2. Als `heat` niet meer aanwezig is → echte stekker/ketel uit

De schakelaar **Woonkamer kachel** is optioneel. Alleen zichtbaar met `"showHeaterSwitch": true`.

TV-warmtecompensatie zit er niet in.


## Standen in Apple Home

Standaard zijn alleen **Uit** en **Verwarmen** zichtbaar. Koelen en Automatisch staan uit.

```json
"showModeOff": true,
"showModeHeat": true,
"showModeCool": false,
"showModeAuto": false
```

Zet `showModeCool` of `showModeAuto` op `true` als je die stand wel wilt. Na een wijziging de thermostaat in Apple Home even verwijderen en Homebridge herstarten, anders houdt de Woning-app de oude standen vast.
