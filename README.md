# Virtual Smart Thermostat

Homebridge-plugin voor een virtuele thermostaat in Apple Home. De temperatuur komt van een Shelly, een HTTP-url of een webhook. De plugin schakelt zelf niets fysieks, tenzij je een webhook instelt. Voor Apple Home-automations publiceert hij een aanwezigheidssensor die aan gaat als er verwarmd moet worden.

Werkt met Homebridge 1.8 en 2.x.

## Temperatuurbron

Per thermostaat vul je `shellyHost` in met het IP-adres van de Shelly die op het netwerk zit. Een BLU H&T heeft geen eigen IP. Die lees je uit via de Shelly-gateway waar hij via BTHome aan hangt.

De plugin slaat ongeldige waarden over (`999` of leeg) en gebruikt de chiptemperatuur van een relais niet als kamerthermometer. Die is te warm.

| Bron | Shelly | `shellySensor` |
| --- | --- | --- |
| Uni, DS18B20 op 1-Wire | gen1, `/status` → `ext_temperature` | `0` of `1` |
| Plus Add-on, DS18B20 of DHT22 | `temperature:100` en hoger | `100`, `101` |
| BLU H&T via BTHome | gateway, `bthomedevice:200` | `200`, `201` of het MAC-adres |
| Shelly H&T met eigen IP | gen1 of Plus | leeg |

Laat `shellySensor` leeg voor de eerste externe thermometer. `uni`, `addon`, `blu` en `external` doen hetzelfde. `internal` leest alleen de apparaattemperatuur.

Voorbeeld Uni:

```json
"shellyHost": "192.168.1.40",
"shellySensor": "0"
```

Voorbeeld Add-on:

```json
"shellyHost": "192.168.1.41",
"shellySensor": "100"
```

Voorbeeld BLU H&T aan een Plus-gateway:

```json
"shellyHost": "192.168.1.42",
"shellySensor": "200"
```

Optioneel `shellyUser` en `shellyPassword` (basic of digest). Vochtigheid van een DHT22, H&T of BLU H&T wordt op de thermostaat getoond als de Shelly die meestuurt.

Andere bronnen, in deze volgorde als `shellyHost` leeg is:

1. `temperatureUrl`, een URL die een getal of JSON met `temperature` teruggeeft
2. `temperatureSensor`, de naam van een sensor die Homebridge zelf publiceert
3. webhook op poort `18081`

Een HomePod mini kan de plugin niet uitlezen. Die sensor zit alleen in Apple Home. Stuur de waarde dan zelf naar de webhook:

```bash
curl -X POST http://IP-VAN-HOMEBRIDGE:18081/temperature \
  -H 'Content-Type: application/json' \
  -d '{"id":"woonkamer","temperature":21.4}'
```

`id` is het id van de thermostaat in de config.

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
      "shellyHost": "192.168.1.42",
      "shellySensor": "200",
      "defaultTarget": 20,
      "hysteresis": 0.5,
      "minOnSeconds": 90,
      "minOffSeconds": 90,
      "showHeaterSwitch": false,
      "showModeOff": true,
      "showModeHeat": true,
      "showModeCool": false,
      "showModeAuto": false
    }
  ]
}
```

`pollInterval` is de pauze tussen twee metingen, in seconden. `hysteresis` is de marge rond het setpoint. `minOnSeconds` en `minOffSeconds` voorkomen dat de warmtevraag blijft klapperen.

## Standen in Apple Home

Standaard zijn alleen Uit en Verwarmen zichtbaar. Zet `showModeCool` of `showModeAuto` op `true` om Koelen of Automatisch te tonen. Na die wijziging de thermostaat uit Apple Home verwijderen en Homebridge herstarten, anders houdt de Woning-app de oude standen vast.

## Verwarming schakelen

De plugin maakt een aanwezigheidssensor `Woonkamer thermostaat heat`:

- aanwezig = er moet verwarmd worden
- afwezig = verwarming uit

In Apple Home of Eve:

1. Als heat aanwezig is, zet je de echte stekker of ketel aan.
2. Als heat afwezig is, zet je die uit.

Met `showHeaterSwitch: true` komt er ook een schakelaar in Apple Home. Een directe webhook kan zo:

```json
"appliances": [
  {
    "name": "Ketel",
    "type": "heater",
    "controlType": "webhook",
    "webhook": "http://192.168.1.50/api/heater"
  }
]
```

## Installeren

In Homebridge: plugin `homebridge-virtual-smart-thermostat` bijwerken naar 1.2.2 of nieuwer.

Of handmatig:

```text
/var/lib/homebridge/node_modules/homebridge-virtual-smart-thermostat
```

In Docker:

```text
/homebridge/node_modules/homebridge-virtual-smart-thermostat
```

Herstart Homebridge daarna.
