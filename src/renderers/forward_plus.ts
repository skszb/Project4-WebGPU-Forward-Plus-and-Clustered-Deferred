import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import { Lights } from '../stage/lights';


class ClusterParams 
{
    readonly bufferSize = 12 + 4;
    readonly buffer = new ArrayBuffer(this.bufferSize);
    private readonly uintView = new Uint32Array(this.buffer);

    set numClusters(val: Int32Array) 
    {
        this.uintView.set(val, 0);
    }

    set maxNumLightsPerCluster(val: number)
    {
        this.uintView[3] = Math.floor(val);
    }
}

export class ForwardPlusRenderer extends renderer.Renderer 
{
    // TODO-2: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    clusterLightingBindGroupLayout: GPUBindGroupLayout;
    clusterLightingBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    renderPipeline: GPURenderPipeline;
    clusterAABBComputePipeline: GPUComputePipeline;
    lightCullingComputePipeline: GPUComputePipeline;

    clusterParams: ClusterParams = new ClusterParams();
    clusterParamsBuffer: GPUBuffer;
    clusterSetBuffer: GPUBuffer;
    clusterAABBsBuffer: GPUBuffer;
    
    constructor(stage: Stage) 
    {
        super(stage);
        // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        this.allocateResources();
        this.createBindGroups();
        this.createPipelines();
        this.initializeData();
    }


    override draw() 
    {
        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        var dipatchGroupSizeX = Math.ceil(shaders.constants.numClusters[0] / shaders.constants.workGroupSize[0]); 
        var dipatchGroupSizeY = Math.ceil(shaders.constants.numClusters[1] / shaders.constants.workGroupSize[1]);
        var dipatchGroupSizeZ = Math.ceil(shaders.constants.numClusters[2] / shaders.constants.workGroupSize[2]);


        // cluster AABB 
        const clusterAABBPass = encoder.beginComputePass({label: "forward+ cluster AABB pass"});
        clusterAABBPass.setPipeline(this.clusterAABBComputePipeline);
        clusterAABBPass.setBindGroup(0, this.sceneUniformsBindGroup);
        clusterAABBPass.setBindGroup(1, this.clusterLightingBindGroup);
        clusterAABBPass.dispatchWorkgroups(dipatchGroupSizeX, dipatchGroupSizeY, dipatchGroupSizeZ);
        clusterAABBPass.end();

        // Light culling
        this.resetClusterSetData();
        const lightCullingPass = encoder.beginComputePass({label: "forward+ light culling pass"});
        lightCullingPass.setPipeline(this.lightCullingComputePipeline);
        lightCullingPass.setBindGroup(0, this.sceneUniformsBindGroup);
        lightCullingPass.setBindGroup(1, this.clusterLightingBindGroup);
        lightCullingPass.dispatchWorkgroups(dipatchGroupSizeX, dipatchGroupSizeY, dipatchGroupSizeZ);
        lightCullingPass.end();

        // Render pass
        const renderPass = encoder.beginRenderPass({
            label: "forward+ render pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });
        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        renderPass.setBindGroup(shaders.constants.bindGroup_clusterLighting, this.clusterLightingBindGroup);

        this.scene.iterate(node => {
            renderPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            renderPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            renderPass.setVertexBuffer(0, primitive.vertexBuffer);
            renderPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            renderPass.drawIndexed(primitive.numIndices);
        });
        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }


    allocateResources()
    {
        // depth texture 
        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.depthTextureView = this.depthTexture.createView();

        // cluster lighting related buffers
        this.clusterParamsBuffer = renderer.device.createBuffer({   // ClusterParams
            label: "cluster params buffer",
            size: this.clusterParams.bufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        
        this.clusterAABBsBuffer = renderer.device.createBuffer({   // AABB
            label: "cluster aabbs buffer",
            size: shaders.constants.totalClusterCount * 32,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.clusterSetBuffer = renderer.device.createBuffer({   // ClusterSet
            label: "cluster set buffer",
            // Pad to 16 byte boundaries for alignment (larger than required but I don't want to deal with alignment issues)
            size: Math.ceil((1 + shaders.constants.totalClusterCount * shaders.constants.maxNumLightsPerCluster) / 4) * 16 + Math.ceil(shaders.constants.totalClusterCount / 2) * 16, 
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        
    }


    createBindGroups()
    {
        // Uniforms bind group
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,   
                    buffer: { type: "uniform" }          
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lights.lightSetStorageBuffer }
                }
            ]
        });

        // Clustering compute bind group
        this.clusterLightingBindGroupLayout = renderer.device.createBindGroupLayout({
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

        this.clusterLightingBindGroup = renderer.device.createBindGroup({
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
    }


    createPipelines()
    {
        // AABB calculation compute pipeline
        this.clusterAABBComputePipeline = renderer.device.createComputePipeline({
            label: "forward+ cluster AABB compute pipeline",
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,  // camera + lights
                    this.clusterLightingBindGroupLayout,  // clusterParams + AABB + clusterSet
                ]
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "forward+ clustering compute shader",
                    code: shaders.clusteringComputeSrc   // your WGSL compute shader
                }),
                entryPoint: "calculateClusterBounds"  // 
            }
        });

        // Light culling compute pipeline
        this.lightCullingComputePipeline = renderer.device.createComputePipeline({
            label: "forward+ light culling compute pipeline",
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,  // camera + lights
                    this.clusterLightingBindGroupLayout,  // clusterParams + AABB + clusterSet
                ]
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "forward+ light culling compute shader",
                    code: shaders.clusteringComputeSrc,
                }),
                entryPoint: "lightCulling",
            }
        });
        

        // Render pipeline
        let renderPipelineLayout = renderer.device.createPipelineLayout({
            label: "forward+ pipeline layout",
            bindGroupLayouts: [
                this.sceneUniformsBindGroupLayout, 
                renderer.modelBindGroupLayout,
                renderer.materialBindGroupLayout,
                this.clusterLightingBindGroupLayout,
            ]
        });

        this.renderPipeline = renderer.device.createRenderPipeline({
            layout: renderPipelineLayout, 
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "forward+ vert shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [ renderer.vertexBufferLayout ],
                entryPoint: "main",
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "forward+ frag shader",
                    code: shaders.forwardPlusFragSrc,
                }),
                targets: [
                    {
                        format: renderer.canvasFormat,
                    }
                ],
                entryPoint: "main",
            },
        });
    }

    initializeData()
    {
        // fill cluster params buffer
        this.clusterParams.numClusters = shaders.constants.numClusters;
        this.clusterParams.maxNumLightsPerCluster = shaders.constants.maxNumLightsPerCluster;
        renderer.device.queue.writeBuffer(this.clusterParamsBuffer, 0, this.clusterParams.buffer);

        // fill camera uniforms buffer
        renderer.device.queue.writeBuffer(this.camera.uniformsBuffer, 0, this.camera.uniforms.buffer);
    }

    resetClusterSetData()
    {
        renderer.device.queue.writeBuffer(
            this.clusterSetBuffer,
            0,  
            new Uint32Array([0])
          );
    }
}
