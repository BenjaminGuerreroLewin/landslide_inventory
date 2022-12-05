# Landslide Inventory
Workflow to map landslides based on Satellite Imagery and Digital Elevation Models.


The workflow is divided in two steps:

1. pre-process: The JavaScript code runs on the Google Earth Engine platform and will output a ready-to-analyze set of images. The workflow is as follows:
- Downloads an Image Collection from the Landsat 8 satellite, based on an user-provided region of interest.
- Filters out image features that could complicate landslide analysis (e.g., clouds).
- Remove pixels that are located at gently sloping areas, based on SRTM Digital Elevation Model (unlikely to represent landslides, but rather changes in agricultural activity, roads and buildings construction, etc.).
- Compute relevant spectral indices (NDVI, NDSI, ROG) and adds them as bands to each image of the Image Collection.
- Generates pre-earthquake and post-earthquake images based on the median pixel reflectance of the ImageCollection before and after the earthquake, respectively.
- Generates an image corresponding to the difference in between the post- and pre-earthquake images, illustrating the changes in surface reflectance as a consequence of the earthquake.
- Uses the spectral indices of the resulting image from the previous step to generate clusters based on the K-Means algorithm.
- Exports image segmentation to Google Drive - uncomment code lines below to export other images created in the process.



2. Landslides_RandomForest.ipynb: The Jupyter notebook uses the Random Forest algorithm (a supervised Machine Learning algorithm) to determine which categories from the K-Means image (exported in the 'pre-process' code) corresponds to landslides. It requires as inputs the image resulting from the K-Means segmentation and a shapefile of landslides for the same geographical extent. The filepath for both inputs can be set within the code, but it is recommended to be in a unique folder in Google Drive. 




