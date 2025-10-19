/// <reference types="@webgpu/types" />

import { vec3 } from "wgpu-matrix";
import { device } from "../renderer";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";

// h in [0, 1]
function hueToRgb(h: number) {
    let f = (n: number, k = (n + h * 6) % 6) => 1 - Math.max(Math.min(k, 4 - k, 1), 0);
    return vec3.lerp(vec3.create(1, 1, 1), vec3.create(f(5), f(3), f(1)), 0.8);
}

export class Lights {
    private camera: Camera;

    numLights = 512;
    static readonly maxNumLights = 5000;
    static readonly numFloatsPerLight = 8; // vec3f is aligned at 16 byte boundaries

    static readonly lightIntensity = 0.1;

    lightsArray = new Float32Array(Lights.maxNumLights * Lights.numFloatsPerLight);
    lightSetStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    moveLightsComputeBindGroupLayout: GPUBindGroupLayout;
    moveLightsComputeBindGroup: GPUBindGroup;
    moveLightsComputePipeline: GPUComputePipeline;

    // Cluster compute resources
    clusterLightingBindGroupLayout: GPUBindGroupLayout;
    clusterLightingBindGroup: GPUBindGroup;
    clusterAABBComputePipeline: GPUComputePipeline;
    lightCullingComputePipeline: GPUComputePipeline;
    
    clusterParamsBuffer: GPUBuffer;
    clusterSetBuffer: GPUBuffer;
    clusterAABBsBuffer: GPUBuffer;

    constructor(camera: Camera) {
        this.camera = camera;

        this.lightSetStorageBuffer = device.createBuffer({
            label: "lights",
            size: 16 + this.lightsArray.byteLength, // 16 for numLights + padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this.populateLightsBuffer();
        this.updateLightSetUniformNumLights();

        this.timeUniformBuffer = device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.moveLightsComputeBindGroupLayout = device.createBindGroupLayout({
            label: "move lights compute bind group layout",
            entries: [
                { // lightSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.moveLightsComputeBindGroup = device.createBindGroup({
            label: "move lights compute bind group",
            layout: this.moveLightsComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightSetStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                }
            ]
        });

        this.moveLightsComputePipeline = device.createComputePipeline({
            label: "move lights compute pipeline",
            layout: device.createPipelineLayout({
                label: "move lights compute pipeline layout",
                bindGroupLayouts: [ this.moveLightsComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "move lights compute shader",
                    code: shaders.moveLightsComputeSrc
                }),
                entryPoint: "main"
            }
        });

        this.initializeClusterCompute();
    }

    private initializeClusterCompute() {
        // Create cluster compute buffers
        this.clusterParamsBuffer = device.createBuffer({
            label: "cluster params buffer",
            size: 16, // ClusterParams struct size
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        this.clusterAABBsBuffer = device.createBuffer({
            label: "cluster aabbs buffer",
            size: shaders.constants.totalClusterCount * 32, // AABB size
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.clusterSetBuffer = device.createBuffer({
            label: "cluster set buffer",
            size: Math.ceil((1 + shaders.constants.totalClusterCount * shaders.constants.maxNumLightsPerCluster) / 4) * 16 + Math.ceil(shaders.constants.totalClusterCount / 2) * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        // Create cluster compute bind group layout
        this.clusterLightingBindGroupLayout = device.createBindGroupLayout({
            label: "cluster lighting bind group layout",
            entries: [
                {   // clusterParams
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                {   // AABB
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                {   // clusterSets
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                    buffer: { type: "storage" }
                },
            ]
        });

        // Create cluster compute bind group
        this.clusterLightingBindGroup = device.createBindGroup({
            label: "cluster lighting bind group",
            layout: this.clusterLightingBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.clusterParamsBuffer}
                },
                {
                    binding: 1,
                    resource: { buffer: this.clusterAABBsBuffer}
                },
                {
                    binding: 2,
                    resource: { buffer: this.clusterSetBuffer}
                }
            ]
        });

        // Create scene uniforms bind group layout for cluster compute
        const sceneUniformsBindGroupLayout = device.createBindGroupLayout({
            label: "scene uniforms bind group layout for cluster compute",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }          
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        // Create scene uniforms bind group for cluster compute
        const sceneUniformsBindGroup = device.createBindGroup({
            label: "scene uniforms bind group for cluster compute",
            layout: sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lightSetStorageBuffer }
                }
            ]
        });

        // Create compute pipelines
        this.clusterAABBComputePipeline = device.createComputePipeline({
            label: "cluster AABB compute pipeline",
            layout: device.createPipelineLayout({
                bindGroupLayouts: [
                    sceneUniformsBindGroupLayout,  // camera + lights
                    this.clusterLightingBindGroupLayout,  // clusterParams + AABB + clusterSet
                ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "cluster AABB compute shader",
                    code: shaders.clusteringComputeSrc
                }),
                entryPoint: "calculateClusterBounds"
            }
        });

        this.lightCullingComputePipeline = device.createComputePipeline({
            label: "light culling compute pipeline",
            layout: device.createPipelineLayout({
                bindGroupLayouts: [
                    sceneUniformsBindGroupLayout,  // camera + lights
                    this.clusterLightingBindGroupLayout,  // clusterParams + AABB + clusterSet
                ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "light culling compute shader",
                    code: shaders.clusteringComputeSrc,
                }),
                entryPoint: "lightCulling",
            }
        });
    }

    private populateLightsBuffer() {
        for (let lightIdx = 0; lightIdx < Lights.maxNumLights; ++lightIdx) {
            // light pos is set by compute shader so no need to set it here
            const lightColor = vec3.scale(hueToRgb(Math.random()), Lights.lightIntensity);
            this.lightsArray.set(lightColor, (lightIdx * Lights.numFloatsPerLight) + 4);
        }

        device.queue.writeBuffer(this.lightSetStorageBuffer, 16, this.lightsArray);
    }

    updateLightSetUniformNumLights() {
        device.queue.writeBuffer(this.lightSetStorageBuffer, 0, new Uint32Array([this.numLights]));
    }

    doLightClustering(encoder: GPUCommandEncoder) {
        // Initialize cluster params
        const clusterParams = new Uint32Array(4);
        clusterParams.set(shaders.constants.numClusters, 0);
        clusterParams[3] = shaders.constants.maxNumLightsPerCluster;
        device.queue.writeBuffer(this.clusterParamsBuffer, 0, clusterParams);

        // Reset cluster set data
        device.queue.writeBuffer(this.clusterSetBuffer, 0, new Uint32Array([0]));

        // Calculate dispatch group sizes
        const dispatchGroupSizeX = Math.ceil(shaders.constants.numClusters[0] / shaders.constants.workGroupSize[0]);
        const dispatchGroupSizeY = Math.ceil(shaders.constants.numClusters[1] / shaders.constants.workGroupSize[1]);
        const dispatchGroupSizeZ = Math.ceil(shaders.constants.numClusters[2] / shaders.constants.workGroupSize[2]);

        // Create scene uniforms bind group for this frame
        const sceneUniformsBindGroup = device.createBindGroup({
            label: "scene uniforms bind group for cluster compute",
            layout: this.clusterAABBComputePipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lightSetStorageBuffer }
                }
            ]
        });

        // Cluster AABB calculation pass
        const clusterAABBPass = encoder.beginComputePass({label: "cluster AABB pass"});
        clusterAABBPass.setPipeline(this.clusterAABBComputePipeline);
        clusterAABBPass.setBindGroup(0, sceneUniformsBindGroup); // camera + lights
        clusterAABBPass.setBindGroup(1, this.clusterLightingBindGroup); // cluster params + AABB + clusterSet
        clusterAABBPass.dispatchWorkgroups(dispatchGroupSizeX, dispatchGroupSizeY, dispatchGroupSizeZ);
        clusterAABBPass.end();

        // Light culling pass
        const lightCullingPass = encoder.beginComputePass({label: "light culling pass"});
        lightCullingPass.setPipeline(this.lightCullingComputePipeline);
        lightCullingPass.setBindGroup(0, sceneUniformsBindGroup); // camera + lights
        lightCullingPass.setBindGroup(1, this.clusterLightingBindGroup); // cluster params + AABB + clusterSet
        lightCullingPass.dispatchWorkgroups(dispatchGroupSizeX, dispatchGroupSizeY, dispatchGroupSizeZ);
        lightCullingPass.end();
    }

    // CHECKITOUT: this is where the light movement compute shader is dispatched from the host
    onFrame(time: number) {
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        // not using same encoder as render pass so this doesn't interfere with measuring actual rendering performance
        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.moveLightsComputePipeline);

        computePass.setBindGroup(0, this.moveLightsComputeBindGroup);

        const workgroupCount = Math.ceil(this.numLights / shaders.constants.moveLightsWorkgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        device.queue.submit([encoder.finish()]);
    }
}
