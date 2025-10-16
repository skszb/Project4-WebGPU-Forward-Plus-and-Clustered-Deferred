// TODO-2: implement the light clustering compute shader

// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster’s bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.

@group(0) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;

// cluster generation pass
@group(1) @binding(0) var<uniform> clusterParams: ClusterParams;
@group(1) @binding(1) var<storage, read_write> clusterAABBs: array<AABB>;
@group(1) @binding(2) var<storage, read_write> clusterSets: ClusterSet;


// AABB calculation pass
@compute @workgroup_size(${clusteringWorkgroupSize})
fn calculateClusterBounds(@builtin(global_invocation_id) globalIdx: vec3u)
{
    var clusterCount = clusterParams.numClusters;
    var clusterIndex = vec3(globalIdx.x, globalIdx.y, globalIdx.z);

    if (clusterIndex.x >= clusterCount.x || clusterIndex.y >= clusterCount.y || clusterIndex.z >= clusterCount.z)
    {
        return;
    }

    var flattendClusterIndex = flattenClusterIndex(clusterIndex);
    
    // size of each cluster in NDC
    var clusterXLength_ndc = 2.f / f32(clusterCount.x);
    var clusterYLength_ndc = 2.f / f32(clusterCount.y);
    var clusterZLength_ndc = 1.f / f32(clusterCount.z);

    var xMin_ndc = -1.0;
    var yMin_ndc = -1.0;
    var zNear_ndc = 0.0; 

    var clusterZNear_ndc = zNear_ndc + f32(clusterIndex.z) * clusterZLength_ndc;
    var clusterZFar_ndc = clusterZNear_ndc + clusterZLength_ndc;

    var frustumCorners_ndc : array<vec4f, 4>;

    // near min and max
    frustumCorners_ndc[0] = vec4f(xMin_ndc + f32(clusterIndex.x) * clusterXLength_ndc, 
                                    yMin_ndc + f32(clusterIndex.y) * clusterYLength_ndc, 
                                    zNear_ndc + f32(clusterIndex.z) * clusterZLength_ndc, 1.0);
                                    
    frustumCorners_ndc[1] = frustumCorners_ndc[0] + vec4f(clusterXLength_ndc, clusterYLength_ndc, 0, 0); 
    // far min and max
    frustumCorners_ndc[2] = frustumCorners_ndc[0] + vec4f(0, 0, clusterZLength_ndc, 0);
    frustumCorners_ndc[3] = frustumCorners_ndc[1] + vec4f(0, 0, clusterZLength_ndc, 0);
    
    var min_view = vec3f(1000000, 1000000, 1000000);
    var max_view = vec3f(-1000000, -1000000, -1000000);
    for (var i = 0u; i < 4u; i++) 
    {
        var corner_view = ndcToView(frustumCorners_ndc[i]);
        min_view = min(min_view, corner_view);
        max_view = max(max_view, corner_view);
    }

    clusterAABBs[flattendClusterIndex] = AABB(min_view, max_view);
}   

fn ndcToView(v: vec4f) -> vec3f {
    let ret = cameraUniforms.invProjMat * v;
    return ret.xyz / ret.w;
}


// light culling pass
fn lightIntersectAABB(lightPos_world: vec3f, bound: AABB) -> bool
{
    var lightPos_view = (cameraUniforms.viewMat * vec4(lightPos_world, 1.f)).xyz;

    var min = bound.min - ${lightRadius};
    var max = bound.max + ${lightRadius};
    if (lightPos_view.x < min.x || lightPos_view.x > max.x ||
        lightPos_view.y < min.y || lightPos_view.y > max.y ||
        lightPos_view.z < min.z || lightPos_view.z > max.z)
    {
        return false;
    }

    return true;
}

@compute @workgroup_size(${clusteringWorkgroupSize})
fn lightCulling(@builtin(global_invocation_id) globalIdx: vec3u)
{
    var clusterIndex = vec3(globalIdx.x, globalIdx.y, globalIdx.z);
    var clusterCount = clusterParams.numClusters;
    if (clusterIndex.x >= clusterCount.x || clusterIndex.y >= clusterCount.y || clusterIndex.z >= clusterCount.z)
    {
        return;
    }

    var flattendClusterIndex = flattenClusterIndex(clusterIndex);


    // light culling local storage
    var clusterLightCount= 0u;
    var clusterLightIdicesList: array<u32, ${maxNumLightsPerCluster}>;

    var clusterAABB = clusterAABBs[flattendClusterIndex];

    for (var i = 0u; i < lightSet.numLights; i++)
    {
        if (clusterLightCount >= ${maxNumLightsPerCluster}) { break; }

        if (lightIntersectAABB(lightSet.lights[i].pos, clusterAABB))
        {
            clusterLightIdicesList[clusterLightCount] = i;
            clusterLightCount++;
        }
    }

    // debug
    clusterLightCount = 1;
    clusterLightIdicesList[0] = 0;


    var lightBufferAppendStart = atomicAdd(&clusterSets.numLights, u32(clusterLightCount));
    for (var i = 0u; i < clusterLightCount; i++)
    {
        clusterSets.lightIndicesList[lightBufferAppendStart + i] = clusterLightIdicesList[i];
    }
    clusterSets.lightGrid[flattendClusterIndex] = vec2<u32>(lightBufferAppendStart, clusterLightCount);
}