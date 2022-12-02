/* 

Javascript pre-processing workflow that runs on Google Earth Engine. 

The following code to generates a set of images corresponding to: 
(i) The pre-Earthquake image (median of reflectance in the pre-earthquake image dataset)
(ii) The post-Earthquake image (median of reflectance in the post-earthquake image dataset)
(iii) Image documenting the change in spectral indices due to the earthquake-induced landslides 
(iv) Image resulting from the K-Means segmentation algorithm.

The images are exported to Google Drive.

*/

// 'geometry' corresponds to the region of interest (in this case, in the Nepalese Himalayas) and 'geometry2' 
// corresponds to a subregion on which the K-Means algorithm is trained

var geometry = 
    /* color: #98ff00 */
    /* shown: false */
    ee.Geometry.Point([-74.13255007684336, 3.767767166649037]),
    geometry2 = 
    /* color: #0b4a8b */
    /* shown: false */
    /* displayProperties: [
      {
        "type": "rectangle"
      }
    ] */
    ee.Geometry.Polygon(
        [[[-74.37699587762461, 4.008909838689844],
          [-74.37699587762461, 3.5210748613624956],
          [-73.87986452996836, 3.5210748613624956],
          [-73.87986452996836, 4.008909838689844]]], null, false);





// DEFINE GLOBAL VARIABLES
var SLOPE_FILTER = 15;
var CLOUD_COVER = 10;



// Load POI's Landsat Imagery

// Import and filter Landsat8
var imagery = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
  .filterBounds(geometry)
  .filter(ee.Filter.lte('CLOUD_COVER', CLOUD_COVER))
  .filterDate('2012-12','2016-01');


function mask_clouds(img) {
  // Bits 3 and 5 are cloud shadow and cloud, respectively
  var cloudShadowBitMask = (1 << 3); // 1000 in base 2
  var cloudsBitMask = (1 << 5); // 100000 in base 2

  // Get the pixel QA band
  var qa = img.select('QA_PIXEL');

  // Both flags should be set to zero, indicating clear conditions
  var mask = qa
    .bitwiseAnd(cloudShadowBitMask).eq(0)
    .and(qa.bitwiseAnd(cloudsBitMask).eq(0));

  // Mask image with clouds and shadows
  return img.updateMask(mask);
}

var img_mask = imagery.map(mask_clouds);



// CREATE DATASET FOR ANALYSIS

// Define ImageCollections before and after the Gorkha Earthquake (April, 2015)
var pre = img_mask.filterDate('2013-01','2015-03').median();
var post = img_mask.filterDate('2015-05','2015-12' ).median();

// Clip composite Images to Area of Interest
var pre_clip = pre.clip(geometry);
var post_clip = post.clip(geometry);

// Import SRTM 30m Digital ELevation Model of AOI
var DEM = ee.Image("USGS/SRTMGL1_003").clip(geometry);
// Calculate slope of filtered DEM
var slope = ee.Terrain.slope(DEM.reproject({
  crs: 'EPSG:4326',
  scale: 30
  })
);
var slope_mask = slope.gt(10);
var slope = slope.mask(slope_mask);
DEM = DEM.addBands(slope);

// Add elevation and slope bands to Images
var pre_topo = pre_clip.addBands(DEM.select('elevation'));
var post_topo = post_clip.addBands(DEM.select('elevation'));
var pre_gorkha = pre_topo.addBands(DEM.select('slope'));
var post_gorkha = post_topo.addBands(DEM.select('slope'));

// Add Images
Map.addLayer(pre_gorkha, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 0, max: 2500}, 'Pre-Gorkha Earthquake', false);
Map.addLayer(post_gorkha, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 0, max: 2500}, 'Post-Gorkha Earthquake', false);


// EXTRACTION OF SPECTRAL INDICES

// Normalized Difference Vegetation Index
var pre_ndvi = pre_gorkha.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
var post_ndvi = post_gorkha.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
var pre_ndvi = pre_gorkha.addBands(pre_ndvi);
var post_ndvi = post_gorkha.addBands(post_ndvi);

// Normalized Difference Soil-Brightness Index - after Ma et al. (2016) - Journal of Applied Remote Sensing
var pre_ndsi = pre_ndvi.normalizedDifference(['SR_B3', 'SR_B2']).rename('NDSI');
var post_ndsi = post_ndvi.normalizedDifference(['SR_B3', 'SR_B2']).rename('NDSI');
var pre_ndsi = pre_ndvi.addBands(pre_ndsi);
var post_ndsi = post_ndvi.addBands(post_ndsi);

// Red-over-Green ratio
var pre_rog = (pre_ndsi.select('SR_B4')).divide(pre_ndsi.select('SR_B2')).rename('ROG');
var post_rog = (post_ndsi.select('SR_B4')).divide(post_ndsi.select('SR_B2')).rename('ROG');
var pre_rog = pre_ndsi.addBands(pre_rog);
var post_rog = post_ndsi.addBands(post_rog);

// Rename to Original
var pre_gorkha = pre_rog;
var post_gorkha = post_rog;


// Select only relevant bands
var pre_gorkha_idx = pre_gorkha.select('NDVI','NDSI','ROG');//,'slope');
var post_gorkha_idx = post_gorkha.select('NDVI','NDSI','ROG');//,'slope');




// DEFINE FINAL IMAGE
var gorkha = post_gorkha_idx.subtract(pre_gorkha_idx);
gorkha = gorkha.toFloat();

// Add example of Spectral Index
Map.addLayer(gorkha, {bands: ['NDVI'], min: -1, max: 1}, 'NDVI change due to Gorkha Earthquake', false);





// K-MEANS SEGMENTATION -- UNSUPERVISED ML

// Make the training dataset.
var n_clusters = 8;
var training = gorkha.sample({
  'region': geometry2,
  'scale': 30,
  'numPixels': 5000
});

// Instantiate the clusterer and train it.
var clusterer = ee.Clusterer.wekaKMeans(n_clusters).train(training);

// Cluster the input using the trained clusterer.
var kmeans_gorkha = gorkha.cluster(clusterer);

// Display the clusters with random colors.
Map.addLayer(kmeans_gorkha.randomVisualizer(), {}, 'Unsupervised K-means Classification',false);



// EXPORT IMAGE

Export.image.toDrive({
  image: kmeans_gorkha,
  description: 'K-Means Gorkha Landslides',
  scale: 30,
  region: geometry,
  maxPixels: 1e13
});

/*

Export.image.toDrive({
  image: pre_gorkha,
  description: 'Pre-Gorkha Earthquake',
  scale: 30,
  region: geometry,
  maxPixels: 1e13
});


Export.image.toDrive({
  image: post_gorkha,
  description: 'Post-Gorkha Earthquake',
  scale: 30,
  region: geometry,
  maxPixels: 1e13
});


Export.image.toDrive({
  image: gorkha,
  description: 'Gorkha Landslides',
  scale: 30,
  region: geometry,
  maxPixels: 1e13
});


*/

