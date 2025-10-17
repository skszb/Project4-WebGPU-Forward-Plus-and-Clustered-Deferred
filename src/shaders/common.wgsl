// CHECKITOUT: code that you add here will be prepended to all shaders
struct Light 
{
    pos: vec3f,
    color: vec3f
}

struct LightSet 
{
    numLights: u32,
    lights: array<Light>
}

// TODO-2: you may want to create a ClusterSet struct similar to LightSet
struct ClusterParams 
{
    numClusters: vec3<u32> , // x, y, z
    maxNumLightsPerCluster: u32,
}

struct ClusterSet
{
    numLights: atomic<u32>,
    lightIndicesList: array<u32, ${totalClusterCount} * ${maxNumLightsPerCluster}>, 
    lightGrid: array<vec2<u32>, ${totalClusterCount}>,    // offset, light count 
}

struct CameraUniforms 
{
    viewProjMat : mat4x4f,
    projMat : mat4x4f,
    invProjMat : mat4x4f,
    viewMat : mat4x4f,
    zNear : f32,
    zFar : f32,
    eyePos : vec3f,

}

struct AABB 
{
    min: vec3f,
    max: vec3f
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 
{
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f 
{
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, normalize(vecToLight)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}


fn flattenClusterIndex(id: vec3<u32>) -> u32 {
    return id.x + id.y * ${numClusters[0]} + id.z * ${numClusters[0]} * ${numClusters[1]};
}


fn getClusterIndex(ndcX: f32, ndcY: f32, viewZ: f32, cameraUniforms: CameraUniforms) -> vec3<u32> {
    var clusterIndex = vec3<u32>(0, 0, 0);
    clusterIndex.x = clamp(u32(floor((ndcX + 1.0) / 2.0 * ${numClusters[0]})), 0, ${numClusters[0]} - 1);
    clusterIndex.y = clamp(u32(floor((ndcY + 1.0) / 2.0 * ${numClusters[1]})), 0, ${numClusters[1]} - 1);
    clusterIndex.z = u32(floor(log(abs(viewZ) / cameraUniforms.zNear) * ${numClusters[2]}) / log(cameraUniforms.zFar / cameraUniforms.zNear));
    return clusterIndex;
}

// debug
fn murmurHash(x: u32) -> u32 {
    var h = x;
    h ^= h >> 16u;
    h *= 0x7feb352du;    
    h ^= h >> 15u;
    h *= 0x846ca68bu;    
    h ^= h >> 16u;
    return h;
}

fn u32ToColor(id: u32) -> vec3<f32> {
    // Generate three decorrelated hashes
    let r = murmurHash(id * 0xA24BAEDDu + 1u);
    let g = murmurHash(id * 0xA24BAEDDu + 2u);
    let b = murmurHash(id * 0xA24BAEDDu + 3u);

    // Normalize to [0,1]
    return vec3<f32>(
        f32(r & 0xFFu) / 255.0,
        f32((g >> 8u) & 0xFFu) / 255.0,
        f32((b >> 16u) & 0xFFu) / 255.0
    );
}