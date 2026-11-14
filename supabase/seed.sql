-- ~20 LA cafes to get started. Run AFTER schema.sql.
-- PLACEHOLDER DATA: names are real LA cafes, but addresses/links were filled in only where
-- I was confident and everything should be verified and completed in /admin before sharing.
-- (A trigger auto-creates each cafe's discussion community and its chat room.)
insert into public.cafes (name, slug, city, state, address, description) values
 ('Intelligentsia Coffee – Silver Lake', 'intelligentsia-silver-lake', 'Los Angeles', 'CA', '3922 W Sunset Blvd', 'Specialty coffee roaster and bar in Silver Lake.'),
 ('Go Get Em Tiger – Larchmont', 'go-get-em-tiger-larchmont', 'Los Angeles', 'CA', '230 N Larchmont Blvd', 'Neighborhood coffee shop on Larchmont Boulevard.'),
 ('Verve Coffee Roasters – Melrose', 'verve-melrose', 'Los Angeles', 'CA', null, 'Specialty coffee roaster with a Melrose-area cafe.'),
 ('Stumptown Coffee Roasters – Arts District', 'stumptown-arts-district', 'Los Angeles', 'CA', '806 S Santa Fe Ave', 'Roaster and cafe in the Arts District.'),
 ('Handsome Coffee Roasters', 'handsome-coffee-roasters', 'Los Angeles', 'CA', '582 Mateo St', 'Roastery and cafe in the Arts District.'),
 ('Alfred Coffee – Melrose Place', 'alfred-melrose-place', 'West Hollywood', 'CA', '8428 Melrose Pl', 'Known for the "But First, Coffee" storefront.'),
 ('Menotti''s Coffee Stop', 'menottis-coffee-stop', 'Los Angeles', 'CA', '56 Windward Ave', 'Coffee stop steps from the Venice boardwalk.'),
 ('Lamill Coffee', 'lamill-coffee', 'Los Angeles', 'CA', '1636 Silver Lake Blvd', 'Coffee, food and a big bar program in Silver Lake.'),
 ('Cafe Dulce', 'cafe-dulce', 'Los Angeles', 'CA', '134 Japanese Village Plaza Mall', 'Bakery and coffee in Little Tokyo.'),
 ('Maru Coffee', 'maru-coffee', 'Los Angeles', 'CA', null, 'Specialty coffee in LA.'),
 ('Cognoscenti Coffee', 'cognoscenti-coffee', 'Culver City', 'CA', null, 'Specialty coffee in Culver City.'),
 ('Blue Bottle Coffee – Los Angeles', 'blue-bottle-los-angeles', 'Los Angeles', 'CA', null, 'Specialty coffee roaster with LA cafes.'),
 ('Eightfold Coffee', 'eightfold-coffee', 'Los Angeles', 'CA', null, 'Specialty coffee in Echo Park.'),
 ('Bar Nine', 'bar-nine', 'Culver City', 'CA', null, 'Coffee bar in Culver City.'),
 ('Methodical Coffee', 'methodical-coffee', 'Los Angeles', 'CA', null, 'Specialty coffee in LA.'),
 ('Groundwork Coffee', 'groundwork-coffee', 'Los Angeles', 'CA', null, 'LA-based organic coffee roaster with multiple cafes.'),
 ('Philz Coffee', 'philz-coffee', 'Los Angeles', 'CA', null, 'Custom-blended pour-over coffee.'),
 ('Cafe de Leche', 'cafe-de-leche', 'Los Angeles', 'CA', null, 'Neighborhood cafe in Highland Park.'),
 ('Alana''s Coffee Roasters', 'alanas-coffee-roasters', 'Los Angeles', 'CA', null, 'Specialty coffee roaster in LA.'),
 ('Dinosaur Coffee', 'dinosaur-coffee', 'Los Angeles', 'CA', null, 'Coffee shop in Silver Lake.');
