#include <node.h>
#include <cmath>
#include <limits>
#include <iostream>
#include <random>

using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;
using v8::Number;
using v8::Array;
using v8::Exception;

void findOffset(const FunctionCallbackInfo<Value> &args) {
	Isolate *isolate = args.GetIsolate();

	// Check the number of arguments passed.
	if (args.Length() < 2) {
		// Throw an Error that is passed back to JavaScript
		isolate->ThrowException(Exception::TypeError(
					String::NewFromUtf8(isolate, "Wrong number of arguments")));
		return;
	}

	Local<Array> gps = Local<Array>::Cast(args[0]);
	std::vector<double> gpsVelocities;
	for (unsigned int i = 0; i < gps->Length(); ++i) {
		gpsVelocities.push_back(gps->Get(i)->NumberValue());
	}

	Local<Array> bus = Local<Array>::Cast(args[1]);
	std::vector<double> busVelocities;
	for (unsigned int i = 0; i < bus->Length(); ++i) {
		busVelocities.push_back(bus->Get(i)->NumberValue());
	}

	unsigned offset = 0;
	double minCost = std::numeric_limits<double>::infinity();
	for (int i = 0, length = gpsVelocities.size() - busVelocities.size(); i <= length; ++i) {
		double cost = 0;
		for (std::size_t j = 0; j < busVelocities.size(); ++j) {
			cost += std::pow(busVelocities[j] - gpsVelocities[i + j], 100);
			// cost += std::abs(busVelocities[j] - gpsVelocities[i + j]);
		}
		if (cost < minCost) {
			offset = i;
			minCost = cost;
		}
	}

	args.GetReturnValue().Set(Number::New(isolate, offset));
}

void addGaussianNoise(const FunctionCallbackInfo<Value> &args) {
	Isolate *isolate = args.GetIsolate();

	Local<Array> input = Local<Array>::Cast(args[0]);
	Local<Array> output = Array::New(isolate, input->Length());
	std::default_random_engine generator;
	std::normal_distribution<double> dist(args[1]->NumberValue(), args[2]->NumberValue());

	for (unsigned int i = 0; i < input->Length(); ++i) {
		output->Set(i, Number::New(isolate, input->Get(i)->NumberValue() + dist(generator)));
	}

	args.GetReturnValue().Set(output);
}

void init(Local<Object> exports) {
	NODE_SET_METHOD(exports, "findOffset", findOffset);
	NODE_SET_METHOD(exports, "addGaussianNoise", addGaussianNoise);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, init)
