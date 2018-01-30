const Papa = require("papaparse"),
	  path = require("path"),
	  fs = require("fs"),
	  _ = require("underscore"),
	  Worker = require("webworker-threads").Worker,
	  neataptic = require("neataptic"),
	  addon = require("./build/Release/addon"),
{ spawn } = require("child_process"),
	process = require("process");

const architect = neataptic.architect;

console.log(addon.findOffset([2, 4, 3, 8], [5]));
console.log(addon.addGaussianNoise([2, 3, 4], 0, 1));

const base = ".";

const parseCsv = function(file) {
	return new Promise((resolve, reject) => {
		Papa.parse(fs.createReadStream(path.resolve(base, file)), {
			delimiter: ",",
			complete: resolve,
			error: reject,
		});
	}).then(results => _.flatten(results.data));
};

const trimArray = function(a) {
	const b = a.slice();
	while (b[0] === "NA") b.shift();
	while (b[b.length - 1] === "NA") b.pop();
	return b;
};

/**
 * Trims leading and trailing "NA":s from a pair of arrays.
 * The length is the shortest of the arrays.
 */
const trimArrayPair = function(a, b) {
	while (a[0] === "NA" || b[0] === "NA") {
		a.shift();
		b.shift();
	}
	while (a[a.length - 1] === "NA" || b[b.length - 1] === "NA") {
		a.pop();
		b.pop();
	}
};

const arrayAtod = function(a) {
	return a.map(parseFloat);
};

const square = x => x * x;

const findOffset = function(gpsVelocity, busVelocity) {
	let offset = 0, minCost = Infinity;
	for (let i = 0, length = gpsVelocity.length - busVelocity.length - 2; i < length; ++i) {
		const cost = busVelocity.map((v, index) => square(v - gpsVelocity[i + index]))
			.reduce((a, b) => a + b, 0);

		if (cost < minCost) {
			minCost = cost;
			offset = i;
		}
	}
};

const arrayFracSlice = function(a, startFrac, endFrac) {
	return a.slice(startFrac * a.length, endFrac * a.length);
};

/**
 * Assumes that x is in [-30, 30].
 */
const normalizeAngle = x => (x + 30.0) / 60;

const denormalizeAngle = x => x * 60.0 - 30.0;

/**
 * Assumes that x is in [-3.0; 3.0].
 */
const normalizeAcceleration = x => (x + 3.0) / 6.0;

/**
 * Calculate differences of a vector.
 *
 * Takes an object or array Y with m numbers and returns an array
 * dY with m-1 numbers that constitutes the differences:
 * dY = [Y(2)-Y(1) Y(3)-Y(2) ... Y(m)-Y(m-1)]
 * If Y are function values f(1), f(2), ... with a step size of 1,
 * then dY constitutes the approximate derivative of f.
 *
 * NOTE: For a step size other than 1, the differences do NOT constitute
 * the approximate derivative.
 *
 * @param values
 * @returns Array
 */
const diff = function(y) {
	if (y.length <= 1) return [];
	const dy = new Array(y.length - 1);
	for (let i = 0, length = dy.length; i < length; ++i) {
		dy[i] = y[i + 1] - y[i];
	}
	return dy;
}

/**
 * Creates an array containing the integers [a,b) in ascending order.
 * @param a The start of the range inclusive.
 * @param b The end of the range exclusive.
 * @return An array with numbers in the range.
 */
const range = (a, b) => new Array(b - a).fill().map((v, i) => a + i);

(async function() {
	const gpsVelocity = arrayAtod(trimArray(await parseCsv("gps-velocity.csv")));
	const gpsAngles = arrayAtod(trimArray(await parseCsv("gps-angles.csv")));
	if (gpsVelocity.length !== gpsAngles.length) throw new AssertionError();
	console.log("gps log length:", gpsVelocity.length);

	const trainingData = [];
	const file = fs.createWriteStream("plot.dat");
	file.cork();
	file.write("Time\tphi\ta\ty\t\n");
	let timeIndex = 0;

	let minAcc = Infinity, maxAcc = -Infinity;

	const offsets = [];

	// Skip the first as it's fucking reested
	for (const num of range(2, 9)) {
		let busPhi = await parseCsv("bus-phi-" + num + ".csv");
		let busVelocity = await parseCsv("bus-velocity-" + num + ".csv");
		trimArrayPair(busPhi, busVelocity);
		busPhi = arrayAtod(busPhi);
		busVelocity = arrayAtod(busVelocity);
		const busAcceleration = diff(busVelocity).map(a => a / 0.02); // dv/dt
		busVelocity.pop(); // Pop element used for derivating the acceleration
		if (busPhi.length !== busVelocity.length) throw new AssertionError("Arrays are of unequal length.");

		const velocityOffset = addon.findOffset(arrayFracSlice(gpsVelocity, 0, 1), busVelocity);
		const angleOffset = addon.findOffset(gpsAngles, busPhi.map((val, i) => val - busAcceleration[i]));
		console.log("Bus log " + num + " length: " + busPhi.length.toString().padStart(4) + " offset: " + velocityOffset.toString().padStart(5));
		console.log("Bus angle offset " + angleOffset);
		const offset = angleOffset;
		offsets[num] = offset;

		// Append to training data
		console.log(0.02 * timeIndex);
		for (let i = 0; i < busPhi.length; ++i, ++timeIndex) {
			if (busAcceleration[i] < minAcc) minAcc = busAcceleration[i];
			if (busAcceleration[i] > maxAcc) maxAcc = busAcceleration[i];
			if (i % 10 === 0) {
				file.write(0.02 * timeIndex + "\t"
						+ busPhi[i] + "\t"
						+ busAcceleration[i] + "\t"
						+ gpsAngles[offset + i] + '\n');

				trainingData.push({
					input: [ normalizeAcceleration(busAcceleration[i]), normalizeAngle(busPhi[i]) ],
					output: [ normalizeAngle(gpsAngles[offset + i]) ]
				});
			}
		}
	}

	file.end();

	// Train neural network
	const train = false;
	if (train) {
		console.log("Training neural network.");
		const net = new architect.NARX(2, [ 3 ], 1, 1, 6);
		const result = net.train(trainingData, {
			log: 200,
			iterations: 10000,
			error: 0.0002,
			rate: 0.5,
			shuffle: true,
			clear: true,
			batchSize: 20,
		});
		console.log(result);
		fs.writeFileSync("net.json", JSON.stringify(net.toJSON()));
	} else {
		const net = neataptic.Network.fromJSON(JSON.parse(fs.readFileSync("net.json", "utf8")));
		let busPhi = await parseCsv("bus-phi-7.csv");
		let busVelocity = await parseCsv("bus-velocity-7.csv");
		trimArrayPair(busPhi, busVelocity);
		busPhi = arrayAtod(busPhi);
		busVelocity = arrayAtod(busVelocity);
		const busAcceleration = diff(busVelocity).map(a => a / 0.02); // dv/dt

		const gnuplot = spawn("gnuplot");
		gnuplot.stdout.on("data", data => {
			console.log(data.toString());
		});
		gnuplot.stderr.on("data", data => {
			console.log(data.toString());
		});
		// gnuplot.stdin.write("set terminal dumb\n"); // Dumb
		gnuplot.stdin.write("set terminal png\n");
		gnuplot.stdin.write("set output \"netresult.png\"\n");
		gnuplot.stdin.write("plot '-' using 1:2 with lines, '-' using 1:2 with lines\n");
		for (let i = 0; i < busPhi.length; ++i) {
			if (i % 10 === 0) {
				const result = denormalizeAngle(net.activate([normalizeAcceleration(busAcceleration[i]), normalizeAngle(busPhi[i])]));
				console.log(result);
				gnuplot.stdin.write("" + i + ' ' + result + '\n');
			}
		}

		gnuplot.stdin.write("end");
		for (let i = 0; i < busPhi.length; ++i) {
			if (i % 10 === 0) {
				gnuplot.stdin.write("" + i + ' ' + busPhi[i] + '\n');
			}
		}
		gnuplot.stdin.write("end");
		gnuplot.stdin.end();
	}
})();
