// TODO-2: implement the Forward+ fragment shader

// See naive.fs.wgsl for basic fragment shader setup; this shader should use light clusters instead of looping over all lights

// ------------------------------------
// Shading process:
// ------------------------------------
// Determine which cluster contains the current fragment.
// Retrieve the number of lights that affect the current fragment from the cluster’s data.
// Initialize a variable to accumulate the total light contribution for the fragment.
// For each light in the cluster:
//     Access the light's properties using its index.
//     Calculate the contribution of the light based on its position, the fragment’s position, and the surface normal.
//     Add the calculated contribution to the total light accumulation.
// Multiply the fragment’s diffuse color by the accumulated light contribution.
// Return the final color, ensuring that the alpha component is set appropriately (typically to 1).

@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

@group(${bindGroup_clusterLighting}) @binding(2) var<storage, read_write> clusterSet: ClusterSet;


struct FragmentInput
{
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f,
    @location(3) ndcPos: vec3f,
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }
        

    var clusterIndex = ndcToClusterIndex(in.ndcPos);
    var flattenedClusterIndex = flattenClusterIndex(clusterIndex);
    var clusterLightInfo : vec2<u32> = clusterSet.lightGrid[flattenedClusterIndex];

    var totalLightContrib = vec3f(0, 0, 0);
    for (var lightIdx = clusterLightInfo.x; lightIdx < clusterLightInfo.x + clusterLightInfo.y; lightIdx++) {
        let light = lightSet.lights[lightIdx];
        totalLightContrib += calculateLightContrib(light, in.pos, normalize(in.nor));
    }

    var finalColor = u32ToColor(flattenedClusterIndex);// diffuseColor.rgb * totalLightContrib;
    return vec4(finalColor, 1);
}