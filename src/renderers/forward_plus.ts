import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import { Lights } from '../stage/lights';


export class ForwardPlusRenderer extends renderer.Renderer 
{
    // TODO-2: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    renderPipeline: GPURenderPipeline;
    
    constructor(stage: Stage) 
    {
        super(stage);
        // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        this.allocateResources();
        this.createBindGroups();
        this.createPipelines();
    }


    override draw() 
    {
        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        // Cluster compute 
        this.lights.doLightClustering(encoder);

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
        renderPass.setBindGroup(shaders.constants.bindGroup_clusterLighting, this.lights.clusterLightingBindGroup);

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


    private allocateResources()
    {
        // depth texture 
        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        this.depthTextureView = this.depthTexture.createView();
    }


    private createBindGroups()
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

    }


    private createPipelines()
    {
        // Render pipeline
        let renderPipelineLayout = renderer.device.createPipelineLayout({
            label: "forward+ pipeline layout",
            bindGroupLayouts: [
                this.sceneUniformsBindGroupLayout, 
                renderer.modelBindGroupLayout,
                renderer.materialBindGroupLayout,
                this.lights.clusterLightingBindGroupLayout,
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
}
