import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';


export class ClusteredDeferredRenderer extends renderer.Renderer {
    // TODO-3: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    // G-buffers
    gPosition: GPUTexture; gPositionView: GPUTextureView;
    gNormal: GPUTexture; gNormalView: GPUTextureView;
    gAlbedo: GPUTexture; gAlbedoView: GPUTextureView;

    gBufferSampler : GPUSampler

    // GBuffer bind group and layouts
    gBufferBindGroupLayout: GPUBindGroupLayout;
    gBufferBindGroup: GPUBindGroup;

    // Pipelines
    gBufferPipeline: GPURenderPipeline;
    renderPipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);
        // TODO-3: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        // you'll need two pipelines: one for the G-buffer pass and one for the fullscreen pass
        
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,  // TODO: check visability
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
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


        let w = renderer.canvas.width;
        let h = renderer.canvas.height;

         // Depth
        this.depthTexture = renderer.device.createTexture({
            size: [w, h],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();

        // G-buffers
        this.gPosition = renderer.device.createTexture({
            size: [w, h],
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        this.gPositionView = this.gPosition.createView();

        this.gNormal = renderer.device.createTexture({
            size: [w, h],
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        this.gNormalView = this.gNormal.createView();

        this.gAlbedo = renderer.device.createTexture({
            size: [w, h],
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        this.gAlbedoView = this.gAlbedo.createView();

        this.gBufferSampler = renderer.device.createSampler({
            label: "g-buffer sampler (nearest)",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
        });

        // G-buffer pass
        this.gBufferPipeline = renderer.device.createRenderPipeline({
            layout: renderer.device.createPipelineLayout({
                label: "G-buffer pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout,
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "deferred g vertex",
                    code: shaders.naiveVertSrc
                }),
                entryPoint: "main",
                buffers: [renderer.vertexBufferLayout]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "deferred g frag",
                    code: shaders.clusteredDeferredFragSrc,
                }),
                entryPoint: "main",
                targets: [
                    { format: this.gPosition.format}, 
                    { format: this.gNormal.format },
                    { format: this.gAlbedo.format },
                ]
            }
        })

        // Render pass
        // TODO: add cluster light binding layout
        this.gBufferBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "g-buffer bind group layout",
            entries: [
                { // position
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // normal
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // albedo
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                {   // sampler
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                }
            ]
        });

        this.gBufferBindGroup = renderer.device.createBindGroup({
            label: "g-buffer bind group",
            layout: this.gBufferBindGroupLayout,
            entries: [
                {
                    binding: 0, 
                    resource: this.gPositionView,
                },
                {
                    binding: 1,
                    resource: this.gNormalView,
                },
                {
                    binding: 2,
                    resource: this.gAlbedoView,
                },
                { 
                    binding: 3, 
                    resource: this.gBufferSampler,
                },
            ],
        })      

    }

    override draw() {
        // TODO-3: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the G-buffer pass, outputting position, albedo, and normals
        // - run the fullscreen pass, which reads from the G-buffer and performs lighting calculations
        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        const gBufferPass = encoder.beginRenderPass({
            colorAttachments: [
                {   // position
                    view: this.gPositionView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {   // normal
                    view: this.gNormalView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {   // albedo
                    view: this.gAlbedoView,
                    clearValue: [0, 0, 0, 1],
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

        gBufferPass.setPipeline(this.gBufferPipeline);

        gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        
        this.scene.iterate(
            node => { gBufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup); },
            material => { gBufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup); }, 
            primitive => {
                gBufferPass.setVertexBuffer(0, primitive.vertexBuffer);
                gBufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
                gBufferPass.drawIndexed(primitive.numIndices);
            }
        );

        gBufferPass.end();

        renderer.device.queue.submit([encoder.finish()]);

        // Render
    }
}
