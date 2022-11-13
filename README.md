# landslide_inventory
Workflow to map landslides based on Satellite Imagery and Digital Elevation Models.


The workflow is divided in two steps:

1. pre-process: The JavaScript code runs on the Google Earth Engine platform and outputs a ready-to-analyze set of images. The workflow is as follows:
- Downloads an Image Collection from the Sentinel 2 satellite, based on an user-provided point of interest.
- Filters out image features that could complicate landslide analysis (e.g., clouds, clouds shadow, water bodies, etc).
- Remove pixels that are located at gently sloping areas, based on SRTM Digital Elevation Model (unlikely to represent landslides, but rather changes in agricultural activity, roads and buildings construction, etc.).
- Compute relevant spectral indices (NDVI, NDSI, ROG) and adds them as bands to each image of the Image Collection, together with the topographic slope.
- Pending: Generates a time series of changes in spectral indices (NDVI, NDSI, ROG) from consecutive images.
- Uses (Pending: time series of) spectral indices and topographic slope to generate clusters based on the K-Means algorithm.
- Pending: Exports image segmentation with mean NDVI, NDSI, and ROG values, and topographic slope from each segment of each image in the Image Collection.

2. processing: Soon



