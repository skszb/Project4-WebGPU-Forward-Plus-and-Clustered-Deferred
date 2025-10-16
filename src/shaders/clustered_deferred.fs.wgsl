// TODO-3: implement the Clustered Deferred G-buffer fragment shader

// This shader should only store G-buffer information and should not do any shading.

@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

struct FragmentOutput 
{
    @location(0) pos:       vec4f,
    @location(1) nor:       vec4f,
    @location(2) albedo:    vec4f,
};

@fragment
fn main(in: FragmentInput) -> FragmentOutput
{
    var out : FragmentOutput; 
    let albedo = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (albedo.a < 0.5f) {
        discard;
    }

    out.albedo = albedo;
    out.pos = vec4(in.pos, 1);
    out.nor = vec4(in.nor, 0);

    return out;
}