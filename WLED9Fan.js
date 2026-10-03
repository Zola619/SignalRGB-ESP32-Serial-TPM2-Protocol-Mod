import Serial from "@SignalRGB/serial";
export function Name() { return "ESP32-C3 USB JTAG/Serial - 9 Fan"; }
export function VendorId() { return 0x303A; }
export function ProductId() { return 0x1001; }
export function Publisher() { return "I'm Not MentaL - Modified"; }
export function Size() { return [1, 1]; }
export function DeviceType() { return "lightingcontroller"; }
export function Type() { return "serial"; }
export function ImageUrl() { return "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png"; }
export function SubdeviceController() { return true; }
export function Validate(endpoint) { return endpoint.interface === 0; }
/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
RGBconfig:readonly
*/

const FAN_COUNT = 9;
const LEDS_PER_FAN = 16;
const TOTAL_LEDS = FAN_COUNT * LEDS_PER_FAN;

// SignalRGB safety limit
const DeviceMaxLedLimit = TOTAL_LEDS;

// Each individual fan/channel
const ChannelLedLimit = LEDS_PER_FAN;

// TPM2 packet limit
const MaxLedsPerPacket = 300;

const ChannelArray = [
	["Fan 1", LEDS_PER_FAN],
	["Fan 2", LEDS_PER_FAN],
	["Fan 3", LEDS_PER_FAN],
	["Fan 4", LEDS_PER_FAN],
	["Fan 5", LEDS_PER_FAN],
	["Fan 6", LEDS_PER_FAN],
	["Fan 7", LEDS_PER_FAN],
	["Fan 8", LEDS_PER_FAN],
	["Fan 9", LEDS_PER_FAN],
];

export function ControllableParameters() {
	return [
		{
			"property": "shutdownColor",
			"group": "lighting",
			"label": "Shutdown Color",
			"description": "This color is applied to the device when the System, or SignalRGB is shutting down",
			"min": "0",
			"max": "360",
			"type": "color",
			"default": "#000000"
		},
		{
			"property": "LightingMode",
			"group": "lighting",
			"label": "Lighting Mode",
			"description": "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color",
			"type": "combobox",
			"values": ["Canvas", "Forced"],
			"default": "Canvas"
		},
		{
			"property": "forcedColor",
			"group": "lighting",
			"label": "Forced Color",
			"description": "The color used when 'Forced' Lighting Mode is enabled",
			"min": "0",
			"max": "360",
			"type": "color",
			"default": "#009bde"
		},
		{
			"property": "RGBconfig",
			"group": "lighting",
			"label": "ARGB Configuration",
			"description": "Color order used by the WLED LED outputs",
			"type": "combobox",
			"values": ["RGB", "RBG", "BGR", "BRG", "GBR", "GRB"],
			"default": "GRB"
		},
	];
}

export function Initialize() {
	const deviceInfo = Serial.getDeviceInfo();
	console.log(deviceInfo);

	device.setName(deviceInfo.driverDesc);

	/*
	 * Remove old Channel 1 if the previous version of this
	 * plugin was loaded before.
	 *
	 * This is important because SignalRGB can keep channels
	 * during plugin hot-reloads.
	 */
	try {
		device.removeChannel("Channel 1");
	} catch (e) {
		console.log("No old Channel 1 to remove");
	}

	Serial.disconnect();

	Serial.connect({
		baudRate: 115200,
		dataBits: 8,
		stopBits: 'One',
		parity: 'None'
	});

	if (!Serial.isConnected()) {
		console.log('ESP32 failed to connect');
		return false;
	}

	SetupChannels();

	console.log(
		"ESP32 Initialized - " +
		FAN_COUNT +
		" fans / " +
		TOTAL_LEDS +
		" LEDs"
	);
}

function SetupChannels() {

	// Total device limit = 144 LEDs
	device.SetLedLimit(DeviceMaxLedLimit);

	// Create 9 independent channels
	for (let i = 0; i < ChannelArray.length; i++) {

		const channelName = ChannelArray[i][0];
		const ledLimit = ChannelArray[i][1];

		device.addChannel(channelName, ledLimit);

		console.log(
			"Created " +
			channelName +
			" - " +
			ledLimit +
			" LEDs"
		);
	}
}

export function Render() {

	if (Serial.isConnected()) {
		SendAllFans();
	}
}

function SendAllFans(shutdown = false) {

	let allRGBData = [];

	/*
	 * Collect each fan in order:
	 *
	 * Fan 1 -> LED 0-15
	 * Fan 2 -> LED 16-31
	 * Fan 3 -> LED 32-47
	 * ...
	 * Fan 9 -> LED 128-143
	 */

	for (let i = 0; i < FAN_COUNT; i++) {

		const channelName = ChannelArray[i][0];
		const componentChannel = device.channel(channelName);

		if (!componentChannel) {
			console.log("Channel not found: " + channelName);
			continue;
		}

		let channelLedCount = 0;

		/*
		 * SignalRGB's current Component API uses LedCount()
		 */
		try {
			channelLedCount = componentChannel.LedCount();
		} catch (e) {
			/*
			 * Compatibility fallback for the older API
			 */
			channelLedCount = componentChannel.ledCount || 0;
		}

		/*
		 * Always send exactly 16 LEDs per fan.
		 *
		 * This keeps the WLED address mapping fixed:
		 * Fan 1 = 0-15
		 * Fan 2 = 16-31
		 * ...
		 */
		let fanRGBData = [];

		if (shutdown) {

			fanRGBData = device.createColorArray(
				shutdownColor,
				LEDS_PER_FAN,
				'Inline',
				RGBconfig
			);

		} else if (LightingMode === 'Forced') {

			fanRGBData = device.createColorArray(
				forcedColor,
				LEDS_PER_FAN,
				'Inline',
				RGBconfig
			);

		} else if (componentChannel.shouldPulseColors()) {

			const pulseColor =
				device.getChannelPulseColor(
					channelName,
					LEDS_PER_FAN
				);

			fanRGBData = device.createColorArray(
				pulseColor,
				LEDS_PER_FAN,
				'Inline',
				RGBconfig
			);

		} else if (channelLedCount > 0) {

			fanRGBData =
				componentChannel.getColors(
					'Inline',
					RGBconfig
				);

		} else {

			/*
			 * If the channel has not been configured yet,
			 * send black for its 16 LEDs.
			 */
			fanRGBData = device.createColorArray(
				"#000000",
				LEDS_PER_FAN,
				'Inline',
				RGBconfig
			);
		}

		/*
		 * Make absolutely sure each fan contributes
		 * exactly 16 LEDs.
		 */

		const expectedBytes = LEDS_PER_FAN * 3;

		if (fanRGBData.length > expectedBytes) {

			fanRGBData =
				fanRGBData.slice(0, expectedBytes);

		} else if (fanRGBData.length < expectedBytes) {

			while (fanRGBData.length < expectedBytes) {
				fanRGBData.push(0);
			}
		}

		/*
		 * Convert SignalRGB color order into normal RGB
		 * before sending TPM2 to WLED.
		 */
		const fanRGBObjects =
			ConvertToRGBObjects(fanRGBData);

		for (let led = 0; led < fanRGBObjects.length; led++) {

			allRGBData.push(fanRGBObjects[led].r);
			allRGBData.push(fanRGBObjects[led].g);
			allRGBData.push(fanRGBObjects[led].b);
		}
	}

	/*
	 * We should now have:
	 *
	 * 9 fans × 16 LEDs × 3 bytes
	 *
	 * = 432 RGB bytes
	 *
	 * = 144 LEDs
	 */

	const totalLEDs =
		Math.floor(allRGBData.length / 3);

	console.log(
		"Sending " +
		totalLEDs +
		" LEDs"
	);

	const numPackets =
		Math.ceil(totalLEDs / MaxLedsPerPacket);

	for (
		let currPacket = 0;
		currPacket < numPackets;
		currPacket++
	) {

		const startLED =
			currPacket * MaxLedsPerPacket;

		const endLED =
			Math.min(
				startLED + MaxLedsPerPacket,
				totalLEDs
			);

		const startByte =
			startLED * 3;

		const endByte =
			endLED * 3;

		const packetData =
			allRGBData.slice(
				startByte,
				endByte
			);

		const packet =
			BuildTPM2Packet(packetData);

		Serial.write(
			Array.from(packet)
		);

		device.pause(1);
	}
}

/*
 * Convert the color array coming from SignalRGB
 * into RGB objects.
 *
 * The original plugin expects RGBconfig (default GRB)
 * and then rearranges it into normal RGB for TPM2/WLED.
 */
function ConvertToRGBObjects(colors) {

	if (colors.length % 3 !== 0) {
		throw new Error(
			"RGB data length must be divisible by 3"
		);
	}

	const result = [];

	for (let i = 0; i < colors.length; i += 3) {

		let r;
		let g;
		let b;

		switch (RGBconfig) {

			case "RGB":
				r = colors[i];
				g = colors[i + 1];
				b = colors[i + 2];
				break;

			case "RBG":
				r = colors[i];
				b = colors[i + 1];
				g = colors[i + 2];
				break;

			case "BGR":
				b = colors[i];
				g = colors[i + 1];
				r = colors[i + 2];
				break;

			case "BRG":
				b = colors[i];
				r = colors[i + 1];
				g = colors[i + 2];
				break;

			case "GBR":
				g = colors[i];
				b = colors[i + 1];
				r = colors[i + 2];
				break;

			case "GRB":
			default:
				g = colors[i];
				r = colors[i + 1];
				b = colors[i + 2];
				break;
		}

		result.push({
			r: r,
			g: g,
			b: b
		});
	}

	return result;
}

function BuildTPM2Packet(colors) {

	if (colors.length % 3 !== 0) {
		throw new Error(
			"Flat color array length must be divisible by 3"
		);
	}

	const payloadSize = colors.length;

	/*
	 * TPM2:
	 *
	 * C9 = Start
	 * DA = Data packet
	 * HH LL = payload size
	 * RGB RGB RGB...
	 * 36 = End
	 *
	 * WLED expects 24-bit RGB for TPM2.
	 */

	const packetSize =
		payloadSize + 5;

	const packet =
		new Uint8Array(packetSize);

	// Start byte
	packet[0] = 0xC9;

	// Data packet
	packet[1] = 0xDA;

	// Payload length MSB
	packet[2] =
		(payloadSize >> 8) & 0xFF;

	// Payload length LSB
	packet[3] =
		payloadSize & 0xFF;

	// RGB data
	for (
		let i = 0;
		i < colors.length;
		i++
	) {

		packet[4 + i] =
			colors[i];
	}

	// End byte
	packet[packetSize - 1] = 0x36;

	return packet;
}

export function Shutdown(SystemSuspending) {

	SendAllFans(true);

	if (Serial.isConnected()) {
		Serial.disconnect();
	}
}