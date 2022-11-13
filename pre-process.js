



// 'geometry' corresponds to the point of interest (in this case, in Taiwan) and 'geometry2' 
// corresponds to a subregion of one of the Images on which the K-Means algorithm is trained

var geometry = /* color: #98ff00 */ee.Geometry.Point([121.02309403849165, 23.84886262147076]),
    geometry2 = 
    /* color: #0b4a8b */
    /* displayProperties: [
      {
        "type": "rectangle"
      }
    ] */
    ee.Geometry.Polygon(
        [[[120.85153002983054, 23.670349905815904],
          [120.85153002983054, 23.506739444497395],
          [121.06027026420554, 23.506739444497395],
          [121.06027026420554, 23.670349905815904]]], null, false);



// DEFINE GLOBAL VARIABLES
var SLOPE_FILTER = 15;
var CLOUD_FILTER = 5;
var CLD_PROB_THRESH = 20;
var NIR_DRK_THRESH = 0.15;
var CLD_PRJ_DIST = 1;
var BUFFER = 50;


// LOAD POI'S SENTINEL 2 DATA

function get_S2(aoi) {

// Import and filter S2
  var imagery = ee.ImageCollection("COPERNICUS/S2_SR")
    .filterBounds(aoi)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', CLOUD_FILTER));
  
  // Import and filter imagery_clouds.
  var imagery_clouds = (ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
    .filterBounds(aoi));

  // Join S2 SR with cloud probability dataset by the 'system:index' property.
  return ee.ImageCollection(ee.Join.saveFirst('cloud_mask').apply({
      'primary': imagery,
      'secondary': imagery_clouds,
      'condition': ee.Filter.equals({
          'leftField': 'system:index',
          'rightField': 'system:index'
      })
  }));  
  
}

var imagery = get_S2(geometry);


// ADD TOPOGRAPHIC DATA TO IMAGE COLLECTION

function add_topo(img) {

  // Get img projection and geometry
  var img_crs = img.select('B4').projection().crs();
  var img_geometry = img.geometry();

  // Import SRTM 30m Digital ELevation Model of AOI
  var DEM = ee.Image("USGS/SRTMGL1_003").clip(img_geometry);
  
  // Calculate slope of filtered DEM
  var Slope = ee.Terrain.slope(DEM.reproject({
    crs: 'EPSG:4326',
    scale: 30
  
    })
  );
  
  // add Slope band to DEM and export
  DEM = DEM.addBands(Slope);
  return img.addBands(DEM);
}

var imagery = imagery.map(add_topo);


// lINES 90 - 242 MOSAIC IMAGES WITH SAME DATE, AND FILTER CLOUDS, SHADOWS, ETC FROM MOSAIC IMAGE COLLECTION

// CLOUD COMPONENTS

// Define a function to add the cloud_mask probability layer 
// and derived cloud mask as bands to an S2 SR image input.

function add_Clouds(img) {
  
  // Get 'cloud_mask' image, subset the probability band.
  var cloud_prob = ee.Image(img.get('cloud_mask')).select('probability');
  
  // Condition 'cloud_mask' by the probability threshold value.
  var is_cloud = cloud_prob.gt(CLD_PROB_THRESH).rename('clouds');
  
  // Add the cloud probability layer and cloud mask as image bands.
  return img.addBands(ee.Image([cloud_prob, is_cloud]));
  //return img.updateMask(is_cloud);
}


// SHADOW COMPONENTS

function add_Shadows(img){
    // Identify water pixels from the SCL band.
    var not_water = img.select('SCL').neq(6);
    // var not_water = img.normalizedDifference(['B3', 'B8']).lt(0.2) // Use this if you are using the TOA version
    // Identify dark NIR pixels that are not water (potential cloud shadow pixels).
    var SR_BAND_SCALE = 1e4;
    var dark_pixels = img.select('B8').lt(NIR_DRK_THRESH * SR_BAND_SCALE).multiply(not_water).rename('dark_pixels');
    // Determine the direction to project cloud shadow from clouds (assumes UTM projection).
    var shadow_azimuth = ee.Number(90).subtract(ee.Number(img.get('MEAN_SOLAR_AZIMUTH_ANGLE')));
    // Project shadows from clouds for the distance specified by the CLD_PRJ_DIST input.
    var cld_proj = (img.select('clouds').directionalDistanceTransform(shadow_azimuth, CLD_PRJ_DIST*10)
        .reproject({'crs': img.select(0).projection(), 'scale': 100})
        .select('distance')
        .mask()
        .rename('cloud_transform'));
    // Identify the intersection of dark pixels with cloud shadow projection.
    var shadows = cld_proj.multiply(dark_pixels).rename('shadows');
    // Add dark pixels, cloud projection, and identified shadows as image bands.
    return img.addBands(ee.Image([dark_pixels, cld_proj, shadows]));
}


function add_mask(img){
    // Add cloud component bands.
    var img_cloud = add_Clouds(img);
    // Add cloud shadow component bands.
    var img_cloud_shadow = add_Shadows(img_cloud);

    // Combine cloud and shadow mask, set cloud and shadow as value 1, else 0.
    var is_cld_shdw = img_cloud_shadow.select('clouds').add(img_cloud_shadow.select('shadows')).gt(0);

    // Remove small cloud-shadow patches and dilate remaining pixels by BUFFER input.
    // 20 m scale is for speed, and assumes clouds don't require 10 m precision.
    var is_cld_shdw2 = (is_cld_shdw.focal_min(2).focal_max(BUFFER*2/20)
        .reproject({'crs': img.select([0]).projection(), 'scale': 20})
        .rename('cloudmask'));

    // Add the final cloud-shadow mask to the image.
    return img_cloud_shadow.addBands(is_cld_shdw2);
}


function apply_cld_shdw_mask(img) {
    // # Subset the cloudmask band and invert it so clouds/shadow are 0, else 1.
    var not_cld_shdw = img.select('cloudmask').not();

    // # Subset reflectance bands and update their masks, return the result.
    return img.select(['B.*', 'elevation', 'slope']).updateMask(not_cld_shdw);
}


// Display all of the cloud and cloud shadow components
// The input is an image collection where each image is the result of the add_cld_shdw_mask function
var img = imagery.map(add_mask);


// Mosaic function that maps through unique dates within the image collection
function mosaicByDate(imcol){
  // imcol: An image collection
  // returns: An image collection
  var imlist = imcol.toList(imcol.size());

  var unique_dates = imlist.map(function(im){
    return ee.Image(im).date().format("YYYY-MM-dd")}).distinct();

  var mosaic_imlist = unique_dates.map(function(d){
    d = ee.Date(d);

    var im = imcol
      .filterDate(d, d.advance(1, "day"))
      .mosaic();

    return im.set(
        "system:time_start", d.millis(), 
        "system:id", d.format("YYYY-MM-dd"));
  });

  return ee.ImageCollection(mosaic_imlist);
}

var mosaic_img = mosaicByDate(img);


//Subset layers and prepare them for display
//selfmask updates the image's mask at all positions where the existing mask is not zero 
var clouds = mosaic_img.map(function(img){
  return img.select('clouds').selfMask();
});
var shadows = mosaic_img.map(function(img){
  return img.select('shadows').selfMask();
});
var dark_pixels = mosaic_img.map(function(img){
  return img.select('dark_pixels').selfMask();
});
var probability = mosaic_img.map(function(img){
  return img.select('probability');
});
var cloudmask = mosaic_img.map(function(img){
  return img.select('cloudmask').selfMask();
});
var cloud_transform = mosaic_img.map(function(img){
  return img.select('cloud_transform');
});

var masked_img = mosaic_img.map(apply_cld_shdw_mask);


//ADD LAYERS TO THE MAP.

//Add original image layer
Map.addLayer(img, {bands: ['B4', 'B3', 'B2'], min: 0, max: 2500}, 'Image', false);

//Add clouds layer
//Map.addLayer(clouds, {palette: '74fffc'}, 'CLOUDS', false);

//Add cloud shadows layer
//Map.addLayer(shadows, {palette: '0a0cff'}, 'SHADOWS', false);

//Add dark pixels layer
//Map.addLayer(dark_pixels, {palette: 'ffc227'}, 'DARK_PIXELS', false);

//Add cloud probability layer 
//Map.addLayer(probability, {min: 0, max: 100}, 'PROBABILITY (cloud)', false);

//Add cloud mask layer
//Map.addLayer(cloudmask, {palette: 'ff550c'}, 'CLOUD MASK', false);

//Add cloud transform layer
//Map.addLayer(cloud_transform, {'min': 0, 'max': 1, 'palette': ['white', 'black']}, 'CLOUD TRANSFORM', false);

//Add masked image layer
Map.addLayer(masked_img, {bands: ['B4', 'B3', 'B2'], min: 0, max: 2500}, 'Masked Image',false);




// LINES 250 - 285 CALCULATE NDVI, NDSI, AND ROG FOR EVERY IMAGE IN IMAGE COLLECTION 


// EXTRACTION OF SPECTRAL INDICES

// Normalized Difference Vegetation Index
function add_NDVI(image) {
  var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return image.addBands(ndvi);
}
var with_ndvi = masked_img.map(add_NDVI); 

// Normalized Difference Soil-Brightness Index - after Ma et al. (2016) - Journal of Applied Remote Sensing
function add_NDSI(image) {
  var ndsi = image.normalizedDifference(['B3', 'B2']).rename('NDSI');
  return image.addBands(ndsi);
}
var with_ndsi = with_ndvi.map(add_NDSI);

// Red-over-Green ratio
function add_ROG(image) {
  var rog = (image.select('B4')).divide(image.select('B2')).rename('ROG');
  return image.addBands(rog);
}
var with_rog = with_ndsi.map(add_ROG);

// Rename pre-processed ImageCollection
var img = with_rog;



// Mask by slope (retain slopes greater than 15º)
function slope_mask(img) {
  var slope = img.select('slope');
  var mask = slope.gt(15);
  return img.mask(mask);
}

var img = img.map(slope_mask);


// PENDING: LINES 290 - 336 WILL GENERATE A TIME SERIES OF SPECTRAL INDICES VARIATIONS ON WHICH TO RUN K-MEANS

// Generate temporal difference in spectral indices and topographic extent
var list_size = img.size().subtract(ee.Number(1));
var spectral_idx = img.select('NDVI','NDSI','ROG','slope');

/* This is my (unfinished) attempt to generate an ImageCollection with the time-difference
of the variables that will predict landslides. I had trouble iterating over the lists so 
I continued working with the original spectral values as if they were the time-differences.

var NDVI_list = ee.List([]);
var NDSI_list = img.select('NDSI').toList(list_size);
var ROG_list = img.select('ROG').toList(list_size);
var slope_list = img.select('slope').toList(list_size);

for (var i = 0; i < img.size(); i++) {
  var image1 = ee.Image(spectral_idx.get(i));
  var image2 = ee.Image(spectral_idx.get(i+1));
  var change = image2.subtract(image1);
  NDVI_list.push(change.select('NDVI'));
  NDSI_list[i] = change.select('NDSI');
  ROG_list[i] = change.select('ROG');
  slope_list[i] = change.select('slope');
}

// Lists to ImageCollection
var diff_NDVI = ee.ImageCollection.fromImages(NDVI_list);
var diff_NDSI = ee.ImageCollection.fromImages(NDSI_list);
var diff_ROG = ee.ImageCollection.fromImages(ROG_list);
var diff_elevation = ee.ImageCollection.fromImages(elevation_list);
var diff_slope = ee.ImageCollection.fromImages(elevation_list);

print(diff_NDVI);


var preproc_img = ee.ImageCollection(ee.Join.saveAll('test').apply({
      'primary': diff_NDVI, 
      'secondary': diff_NDSI, 
      'condition': ee.Filter.equals({
          'leftField': 'system:index',
          'rightField': 'system:index'
      })
  }));  

print(preproc_img);



*/

Map.addLayer(spectral_idx.first(), {bands: ['NDVI'], min: -1, max: 1}, 'NDVI', false);




// LINES 345 - 366 PERFORM K-MEANS ON IMAGE COLLECTION 

// K-Means segmentation -- Unsupervised

// Make the training dataset.
var train_img = spectral_idx.first();
var n_clusters = 8;
var training = train_img.sample({
  'region': geometry2,
  'scale': 10,
  'numPixels': 5000
});
// Instantiate the clusterer and train it.
var clusterer = ee.Clusterer.wekaKMeans(n_clusters).train(training);

function kmeans(img){
  // Cluster the input using the trained clusterer.
  var kmeans_result = img.cluster(clusterer);
  return kmeans_result;
}
var kmeans_result = spectral_idx.map(kmeans);

// Display the clusters with random colors.
Map.addLayer(kmeans_result.first().randomVisualizer(), {}, 'Unsupervised K-means Classification');



// PENDING: ADDBANDS WITH MEAN VALUE OF INDICES AND IMAGE EXTRACTION
