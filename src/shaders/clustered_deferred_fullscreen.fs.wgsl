// TODO-3: implement the Clustered Deferred fullscreen fragment shader

// Similar to the Forward+ fragment shader, but with vertex information coming from the G-buffer instead.

@group(0) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;

@group(1) @binding(0) var gPositionTex: texture_2d<f32>;
@group(1) @binding(1) var gNormalTex: texture_2d<f32>;
@group(1) @binding(2) var gAlbedoTex: texture_2d<f32>;
@group(1) @binding(3) var gBufferSampler: sampler;

@group(2) @binding(2) var<storage, read_write> clusterSet: ClusterSet;

struct FragmentInput
{
    @location(0) uv: vec2f,
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    let UV = vec2f(in.uv.x, in.uv.y);

    let pos: vec3f = textureSample(gPositionTex, gBufferSampler, UV).xyz;
    let nor: vec3f = textureSample(gNormalTex, gBufferSampler, UV).xyz;
    let albedo: vec4f = textureSample(gAlbedoTex, gBufferSampler, UV);

    if (albedo.a < 0.5f) {
        discard;
    }

    var clusterIndex = vec3<u32>(
        clamp(u32(floor(UV.x * f32(${numClusters[0]}))), 0u, ${numClusters[0]} - 1u),
        clamp(u32(floor((1.0 - UV.y) * f32(${numClusters[1]}))), 0u, ${numClusters[1]} - 1u),
        0
    );

    var viewZ = (cameraUniforms.viewMat * vec4(pos, 1.0)).z;
    let zIdx = u32(floor(log(-viewZ / cameraUniforms.zNear) * ${numClusters[2]} / log(cameraUniforms.zFar / cameraUniforms.zNear)));
    clusterIndex.z = clamp(zIdx, 0, ${numClusters[2]} - 1);

    var flattendClusterIndex: u32 = flattenClusterIndex(clusterIndex);
    var clusterlightGridInfo = clusterSet.lightGrid[flattendClusterIndex];
    var clusterLightIndicesStart = clusterlightGridInfo.x;
    var clusterLightCount = clusterlightGridInfo.y;

    var totalLightContrib = vec3f(0, 0, 0);

    for (var i = 0u; i < clusterLightCount; i++)
    {
        var lightIndex = clusterSet.lightIndicesList[clusterLightIndicesStart + i];
        var lightContrib = calculateLightContrib(lightSet.lights[lightIndex], pos, nor);
        totalLightContrib += lightContrib;
    }
    
    var finalColor = albedo.rgb * totalLightContrib;
    return vec4(finalColor, 1);
}